# NotApex's Plugins

Plugins for Vendetta-based Discord mobile client mods.

## Installing

Copy the link below and paste it into the Plugins page of your client.
Don't click it — clicking gives you a 404, because it's a plugin
endpoint rather than a web page.

- **Local Message** — `https://notapex.github.io/test/messagar/`

## Local Message

Adds `/message`, which renders a message in the current channel that is
visible only to you. Nothing is transmitted to Discord, so no one else
in the channel sees anything.

| Option    | Type    | Description                                              |
| --------- | ------- | -------------------------------------------------------- |
| `name`    | string  | Display name. Falls back to the default in settings.      |
| `pfp`     | string  | Image URL, or a built-in asset name such as `clyde`.      |
| `id`      | string  | Pull the pfp from a cached user id. `pfp:` wins if both.  |
| `message` | string  | Message content.                                          |
| `bot`     | boolean | Show the BOT tag. Defaults to on.                         |

## Building

```bash
pnpm m i
node build.mjs
```

Output lands in `dist/`. Pushing to `main` builds and deploys
automatically via GitHub Actions.
