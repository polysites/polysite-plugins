## What and why

<!-- What changed, and why. Link the issue it closes, if any. -->

## Checklist

- [ ] **Tests:** I added or updated tests, and ran the plugin's own tests (`npm test` in the plugin folder, inside a container) and the end-to-end checks that cover it.
- [ ] **Docs:** I updated the guides or READMEs that describe what I changed (and the changelog, if it is user-visible).
- [ ] **Schema change?** The plugin ships its own migration, generated with the core's `scripts/pluginMigrations.sh`, and the core's plugin-isolation check (`sh scripts/pluginMigrations.sh check`, also `npm run check:plugin-isolation` in `apps/cms`) passes.
- [ ] The plugin reaches the core only through its extension points; its README and `package.json` manifest are up to date, including any settings and environment variables.
- [ ] Removing or switching the plugin off still deletes nothing.
- [ ] **No secrets or personal data:** no passwords, tokens, keys or real people's details in the code, tests, fixtures, logs or screenshots.
- [ ] I read CONTRIBUTING.md in the core repository, including the contribution terms.

## How I checked it

<!-- Commands run, pages clicked through, screenshots for anything visual. -->
