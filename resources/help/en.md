# Kot-kod help

Kot-kod is a graphical Git client for Linux and Steam Deck. It works with any Git repository and additionally supports pull requests, issues, forks and notifications for **GitHub** and **GitVerse**.

## Getting started

1. Make sure Git 2.35 or newer is installed (`git --version`).
2. Open **Accounts → Add account** and sign in to GitHub or GitVerse with a personal token (or the browser, if an OAuth Client ID is configured).
3. On the start screen choose **Clone**, **Create** or **Add local**.

## Changes and commits

- The left pane lists changed files; a checked box means the file is included in the commit.
- The right pane shows the diff. Click line numbers to select individual lines, then press **Stage lines**. Buttons above each hunk stage or discard the whole hunk.
- Enter a summary and an optional description at the bottom. **Amend last commit** rewrites the previous commit.
- Right-click a file to discard changes, add it to `.gitignore` or open it.

## Sync

The top bar button adapts: **Fetch**, **Pull**, **Push** or **Publish branch**. When a push is rejected you can pull (merge or rebase) or force-push with `--force-with-lease`.

All local operations work offline; once back online the app reminds you about unpushed commits.

## History and branches

- **History** shows the commit graph with search by message, author or hash. Right-click a commit for cherry-pick, revert, reset (soft / mixed / hard), new branch or tag, interactive rebase.
- **Branches**: create, switch, rename, delete (also on the server), merge (regular, `--no-ff`, squash) and rebase.
- On conflicts a yellow banner appears. Open the conflicted file, pick ours/theirs or edit the result and press **Mark as resolved**, then **Continue**.

## Stash and tags

- **Stash**: save changes (including untracked files), apply, pop, inspect.
- **Tags**: lightweight and annotated tags, push and delete on the server.

## GitHub and GitVerse

- **Pull requests**: list, create (draft, reviewers, labels), files and conversation, comments, approve and merge.
- **Issues**: list, create, comment, labels, close and reopen.
- **Forks**: in **Repository** press **Fork** — origin points to your fork, upstream to the original.
- **Notifications** are available for GitHub; GitVerse does not expose them via API yet.

## Releases

The Releases section lists repository releases on GitHub or GitVerse.

- **New release** — pick an existing tag or type a new one (the hosting creates it on the given branch), set a title and notes. “Fill with commit list” adds commits since the previous tag. Files (AppImage, deb, archives) are attached on publish. An unpushed local tag is pushed automatically.
- **Draft** is saved without publishing; publish it later with “Publish”.
- **Upload files** adds files to an existing release. GitVerse allows only Latin letters, digits, “_”, “-” and “.” in file names: Cyrillic is transliterated.
- **Download / Download all** saves release files to a folder, private repositories included.
- **Copy link** puts the release or file link on the clipboard.
- **Copy to another repository** moves a release with notes and files to another repository, e.g. from GitHub to GitVerse. A missing tag is pushed from the open local repository.
- In Tags, use “Create release” next to a tag.

## Security

Tokens are kept in the system keyring (Secret Service / libsecret). If it is unavailable (e.g. Steam Deck Game Mode) tokens are encrypted with a password you choose on first run. Tokens never appear in logs.

## Steam Deck

- Shipped as an AppImage, no root access needed.
- Designed for 1280×800; scale up to 200% in **Settings**.
- In Game Mode open the on-screen keyboard with **Steam + X**.

## Logs and reports

Logs are stored in `~/.local/state/kot-kod/logs`. **Report a problem** opens an issue form with the app version and recent log lines (tokens are masked).
