# Spacesheep's Sheets skill

Spacesheep's official Sheets skill, in the [Agent Skills](https://agentskills.io/specification) format. The skill is the folder `sheets/`. Everything else here is the repo's own, and never enters a version.

## Change it

1. Edit `sheets/`, then check it:

   ```bash
   npx -y spacesheep@latest skills lint
   ```

2. Add a heading for the version to `CHANGELOG.md` (`## v1.1.0`), with what changed under it.
3. Tag and push the version (`git tag v1.1.0 && git push origin v1.1.0`). `release.yml` checks the skill and makes the release. Spacesheep takes it as a new version of the official skill, which waits for approval.

- **When a change needs the app to change too,** ship the app first, then tag the skill.
- **Never move a tag.** Spacesheep keeps each tag once, with the commit it pointed at. Tag a new version instead.
- **A tag like `v1.1.0-rc1`** becomes a pre-release, which Spacesheep ignores.

## History

Up to `v1.0.0`, the folder's history is the app repo's (`packages/app/skills/official/sheets/`), commit for commit.
