# MCP tool contracts (draft, Stage 0)

All tools are called by the user's own AI agent on their behalf, authenticated via an
OAuth token issued when the user connects agora-mcp as a connector.

## `submit_offer`
Publish something the user has to offer.

| param | type | notes |
|---|---|---|
| `text` | string | free-form description, in the user's own words |
| `category` | string? | optional coarse category for filtering |
| `tags` | string[]? | optional |

Returns: `{ item_id }`

Server distills/embeds `text` server-side with the `offer`-role instruction prefix —
the client never computes or sends an embedding itself, so every item lands in the same
comparable vector space regardless of which AI produced the text.

## `submit_want`
Same shape as `submit_offer`, but for something the user is looking for. Embedded with the
`want`-role instruction prefix.

## `search_matches`
Find candidate matches for one of the user's items (or all of them).

| param | type | notes |
|---|---|---|
| `item_id` | string? | omit to search across all of the user's active items |
| `limit` | number? | default e.g. 10 |

Returns: ranked list of `{ item_id, owner_display_name, text, score, category }` — crossed
appropriately (the user's `offer`s are matched against others' `want`s and vice versa).

## `get_my_items`
List the calling user's own active offers/wants.

Returns: `{ items: [...] }`

## `deactivate_item`
Mark an item inactive (withdrawn, fulfilled, no longer relevant).

| param | type |
|---|---|
| `item_id` | string |

---

Not yet specified: outcome feedback (`report_match_outcome`) — needed starting Stage 1,
intentionally deferred until there's a live matching loop to attach it to.
