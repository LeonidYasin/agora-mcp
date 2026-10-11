import copy
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

CONFIG = Path('/etc/caddy/Caddyfile')
DOMAIN = 'leonid-mcp.duckdns.org'
LOCK = Path('/run/agora-caddy-deploy.lock')
BLOCK = '''\n    # Agora: separate user-token auth, preserve existing MCP routes.
    handle_path /agora/* {
        reverse_proxy 127.0.0.1:3011 {
            header_up Host {upstream_hostport}
        }
    }
'''


def command(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise RuntimeError('Command failed: ' + args[0] + ' ' + args[1])
    return result.stdout


def adapt(path):
    return json.loads(command(['caddy', 'adapt', '--config', str(path), '--adapter', 'caddyfile']))


def canonical(config):
    groups = {}
    def visit(value):
        if isinstance(value, dict):
            out = {}
            for key in sorted(value):
                item = value[key]
                if key == 'group' and isinstance(item, str):
                    item = groups.setdefault(item, 'group-' + str(len(groups)))
                out[key] = visit(item)
            return out
        if isinstance(value, list):
            return [visit(item) for item in value]
        return value
    return visit(config)


def site_routes(config):
    found = []
    servers = config.get('apps', {}).get('http', {}).get('servers', {})
    for server in servers.values():
        for route in server.get('routes', []):
            if route.get('match') == [{'host': [DOMAIN]}]:
                handlers = route.get('handle', [])
                if len(handlers) == 1 and handlers[0].get('handler') == 'subroute':
                    found.append(handlers[0].get('routes', []))
    if len(found) != 1:
        raise RuntimeError('Expected exactly one standalone site for the domain.')
    return found[0]


def objects(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from objects(child)


def verify_change(before, after):
    reduced = copy.deepcopy(after)
    routes = site_routes(reduced)
    added = [r for r in routes if r.get('match') == [{'path': ['/agora/*']}]]
    if len(added) != 1 or routes[0] is not added[0]:
        raise RuntimeError('New path must be the first site route.')
    handlers = list(objects(added[0]))
    proxies = [h for h in handlers if h.get('handler') == 'reverse_proxy']
    if len(proxies) != 1 or proxies[0].get('upstreams') != [{'dial': '127.0.0.1:3011'}]:
        raise RuntimeError('Unexpected Agora upstream.')
    if not any(h.get('strip_path_prefix') == '/agora' for h in handlers):
        raise RuntimeError('Missing path-prefix removal.')
    routes.remove(added[0])
    if canonical(before) != canonical(reduced):
        raise RuntimeError('Other configuration changed; refusing to apply.')


def stage(data, file_stat):
    fd, name = tempfile.mkstemp(prefix='.agora-stage-', dir=CONFIG.parent)
    try:
        with os.fdopen(fd, 'wb') as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        os.chown(name, file_stat.st_uid, file_stat.st_gid)
        os.chmod(name, stat.S_IMODE(file_stat.st_mode))
        return Path(name)
    except BaseException:
        Path(name).unlink(missing_ok=True)
        raise


def status(url):
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def ready(base):
    expected = {'health': ('service', 'agora-mcp'), 'ready': ('database', 'reachable')}
    for endpoint, (key, value) in expected.items():
        with urllib.request.urlopen(base + '/' + endpoint, timeout=5) as response:
            data = json.load(response)
        if data.get('ok') is not True or data.get(key) != value:
            raise RuntimeError('Failed Agora check: ' + endpoint)


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Run as root.')
    if CONFIG.is_symlink() or not CONFIG.is_file():
        raise RuntimeError('Caddyfile must be a regular, non-symlink file.')
    lock_fd = os.open(LOCK, os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(lock_fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        command(['systemctl', 'is-active', '--quiet', 'caddy'])
        ready('http://127.0.0.1:3011')
        original = CONFIG.read_bytes()
        info = CONFIG.stat()
        text = original.decode('utf-8')
        if re.search(r'^\s*import\s+', text, re.M) or '{$' in text:
            raise RuntimeError('Imports/environment substitutions need a separate reviewed patch.')
        before = adapt(CONFIG)
        site_routes(before)
        if any('/agora' in p for obj in objects(before) for p in obj.get('path', []) if isinstance(p, str)):
            raise RuntimeError('An Agora path already exists. Nothing changed.')
        headers = list(re.finditer(r'^\s*' + re.escape(DOMAIN) + r'\s*\{[^\S\n]*(?:#[^\n]*)?$', text, re.M))
        if len(headers) != 1:
            raise RuntimeError('Expected one direct domain declaration in Caddyfile.')
        updated = (text[:headers[0].end()] + BLOCK + text[headers[0].end():]).encode('utf-8')
        old_status = status('https://' + DOMAIN + '/health')
        # Ensure the running HTTP routes agree with the on-disk file.
        with urllib.request.urlopen('http://127.0.0.1:2019/config/', timeout=5) as response:
            running = json.load(response)
        if canonical(running.get('apps', {}).get('http', {})) != canonical(before.get('apps', {}).get('http', {})):
            raise RuntimeError('Running Caddy HTTP config differs from the file. Nothing changed.')
        candidate = stage(updated, info)
        applied = False
        try:
            after = adapt(candidate)
            # Caddy automatically hides the filename used during adaptation.
            for obj in objects(after):
                if obj.get("handler") == "file_server" and "hide" in obj:
                    obj["hide"] = [str(CONFIG) if item == str(candidate) else item for item in obj["hide"]]
            verify_change(before, after)
            command(['caddy', 'validate', '--config', str(candidate), '--adapter', 'caddyfile'])
            if CONFIG.read_bytes() != original:
                raise RuntimeError('Caddyfile changed concurrently. Nothing applied.')
            backup = CONFIG.with_name('Caddyfile.pre-agora.' + time.strftime('%Y%m%d-%H%M%S') + '.' + str(os.getpid()))
            fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'wb') as file:
                file.write(original)
                file.flush()
                os.fsync(file.fileno())
            print('Backup:', backup, flush=True)
            os.replace(candidate, CONFIG)
            applied = True
            command(['systemctl', 'reload', 'caddy'])
            for attempt in range(6):
                try:
                    ready('https://' + DOMAIN + '/agora')
                    if status('https://' + DOMAIN + '/health') != old_status:
                        raise RuntimeError('Old unauthenticated /health status changed.')
                    break
                except Exception:
                    if attempt == 5:
                        raise
                    time.sleep(2)
            print('OK: /agora/health and /agora/ready work over HTTPS.')
            print('Existing config preserved; old unauthenticated /health status unchanged:', old_status)
            print('MCP URL: https://' + DOMAIN + '/agora/mcp')
        except BaseException:
            if applied:
                if CONFIG.read_bytes() != updated:
                    print('STOP: config changed concurrently; automatic rollback refused.', flush=True)
                else:
                    restored = stage(original, info)
                    os.replace(restored, CONFIG)
                    try:
                        command(['systemctl', 'reload', 'caddy'])
                        print('ROLLBACK: original Caddyfile restored and reloaded.', flush=True)
                    except Exception:
                        print('CRITICAL: original file restored, but rollback reload failed.', flush=True)
            raise
        finally:
            candidate.unlink(missing_ok=True)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Add /agora/ to one existing Caddy site, with rollback.')
    parser.add_argument('--domain', default=DOMAIN)
    DOMAIN = parser.parse_args().domain.lower()
    if not re.fullmatch(r'[a-z0-9.-]+', DOMAIN) or '.' not in DOMAIN:
        raise SystemExit('Use a plain DNS hostname, not a URL.')
    try:
        main()
    except BaseException as error:
        # Never print command output, configuration or response bodies.
        print('STOP:', type(error).__name__, str(error) if isinstance(error, RuntimeError) else '(details hidden)')
        raise SystemExit(1)
