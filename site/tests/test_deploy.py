import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]

def load(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'deploy'/f'{name}.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

class ProvisionTests(unittest.TestCase):
    def test_private_files_no_token_in_output(self):
        m=load('provision-user')
        with tempfile.TemporaryDirectory() as d:
            destination=Path(d)/'invites'
            def response(args,**kwargs):
                return type('R',(),{'returncode':0,'stdout':'','stderr':''})()
            output=io.StringIO()
            with patch.object(m.os,'geteuid',return_value=0), patch.object(m,'Path',side_effect=lambda x:destination), patch.object(m.subprocess,'run',side_effect=response), patch('sys.argv',['provision','--external-id','test-b','--display-name','Test B']),contextlib.redirect_stdout(output):
                m.main()
            token=(destination/'test-b.token').read_text().strip()
            self.assertNotIn(token,output.getvalue())
            self.assertEqual((destination/'test-b.token').stat().st_mode&0o777,0o600)
            self.assertEqual(destination.stat().st_mode&0o777,0o700)
            self.assertIn(token,(destination/'test-b.curl').read_text())

    def test_database_failure_removes_new_files(self):
        m=load('provision-user')
        with tempfile.TemporaryDirectory() as d:
            destination=Path(d)/'invites';counter=[0]
            def response(args,**kwargs):
                counter[0]+=1
                return type('R',(),{'returncode':0 if counter[0]==1 else 1,'stdout':'','stderr':'not printed'})()
            with patch.object(m.os,'geteuid',return_value=0),patch.object(m,'Path',side_effect=lambda x:destination),patch.object(m.subprocess,'run',side_effect=response),patch('sys.argv',['p','--external-id','test-b','--display-name','B']):
                with self.assertRaises(SystemExit):m.main()
            self.assertFalse((destination/'test-b.token').exists())
            self.assertFalse((destination/'test-b.curl').exists())

class ConfigTests(unittest.TestCase):
    def test_private_environment_and_password_encoding(self):
        m=load('configure-jina')
        with tempfile.TemporaryDirectory() as d:
            destination=Path(d)/'config';output=io.StringIO()
            with patch.object(m.os,'geteuid',return_value=0),patch.object(m,'Path',side_effect=lambda x:destination),patch.object(m.getpass,'getpass',side_effect=['pass:@/ space','fixture-key']),contextlib.redirect_stdout(output):m.main()
            text=(destination/'agora.env').read_text()
            self.assertIn('pass%3A%40%2F%20space',text)
            self.assertIn('EMBEDDING_MODEL="jina-embeddings-v3"',text)
            self.assertNotIn('fixture-key',output.getvalue())
            self.assertEqual((destination/'agora.env').stat().st_mode&0o777,0o600)

class CaddyTests(unittest.TestCase):
    def fixture(self,m):
        return {'apps':{'http':{'servers':{'srv0':{'routes':[{'match':[{'host':[m.DOMAIN]}],'handle':[{'handler':'subroute','routes':[{'group':'group-old','handle':[{'handler':'reverse_proxy','upstreams':[{'dial':'127.0.0.1:3001'}]}]}]}]}]}}}}}
    def modified(self,m,old):
        after=copy.deepcopy(old)
        m.site_routes(after).insert(0,{'match':[{'path':['/agora/*']}],'group':'group-old','handle':[{'handler':'subroute','routes':[{'handle':[{'handler':'rewrite','strip_path_prefix':'/agora'}]},{'handle':[{'handler':'reverse_proxy','upstreams':[{'dial':'127.0.0.1:3011'}]}]}]}]})
        return after
    def test_extra_change_rejected(self):
        m=load('enable-agora-caddy');before=self.fixture(m);after=self.modified(m,before)
        m.verify_change(before,after)
        for obj in m.objects(after):
            if obj.get('upstreams')==[{'dial':'127.0.0.1:3001'}]:obj['upstreams']=[{'dial':'127.0.0.1:9999'}]
        with self.assertRaises(RuntimeError):m.verify_change(before,after)
    def test_failed_post_reload_check_rolls_back(self):
        m=load('enable-agora-caddy');before=self.fixture(m);after=self.modified(m,before)
        with tempfile.TemporaryDirectory() as d:
            m.CONFIG=Path(d)/'Caddyfile';m.LOCK=Path(d)/'lock'
            original=(m.DOMAIN+' {\n    handle {\n        respond "Unauthorized" 401\n    }\n}\n').encode();m.CONFIG.write_bytes(original)
            reloads=[]
            def command(args):
                if args[0]=='caddy' and args[1]=='adapt':
                    return json.dumps(after if '/agora/*' in Path(args[args.index('--config')+1]).read_text() else before)
                if args[:2]==['systemctl','reload']:reloads.append(True)
                return ''
            def ready(url):
                if url.startswith('https:'):raise RuntimeError('simulated HTTPS failure')
            with patch.object(m.os,'geteuid',return_value=0),patch.object(m,'command',side_effect=command),patch.object(m,'ready',side_effect=ready),patch.object(m,'status',return_value=401),patch.object(m.urllib.request,'urlopen',return_value=io.BytesIO(json.dumps(before).encode())),patch.object(m.time,'sleep'),contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(RuntimeError):m.main()
            self.assertEqual(m.CONFIG.read_bytes(),original)
            self.assertEqual(len(reloads),2)
