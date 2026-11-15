# Changelog

Every change someone using Notevra would notice. Newest first.
Format: [Keep a Changelog](https://keepachangelog.com); versions follow [SemVer](https://semver.org).

## [Unreleased]

## [1.1.0] — 2026-11-15

### Added
- Today looks back: Yesterday, Last 7 days, Last 30 days, and a calendar of which pages changed each day. Click a day to see them, grouped Personal and project.
- Snooze to a date and time you pick, and snooze from the keyboard with ⌥S (Alt+S).
- Choose a reminder sound in Settings → Notifications: Chime, Bell, Soft or Ping.
- Reminders also show as system notifications when Notevra is in the background.

### Changed
- Inbox is now Temp note: a scratch page you can keep as a Planning, Archive or Blank page.
- Mobile tabs are Notes · Today · Search · Me.
- Search finds pages and items. Add blocks with "/" or "Add a block".

### Fixed
- Opening an Archive item from search selects that item instead of the one you had open.
- With Notevra open in two tabs, a reminder plays once.

## [1.0.0] — 2026-11-14

The first stable release. Offline first, Sync Later.

### Changed
- Continue with Google in the desktop app now ends on a page that says you can close the tab, and the Sign in window closes by itself.
- Links in sign-up and password-reset emails, and the desktop app's sign-in hand-off, now work only once.

### Security
- Only people who can edit a shared project can send changes to it, and a synced change can only touch a page's content.
- Nobody joins a project without accepting the invite.
- Very large sync batches are turned away, so one device can't hold up sync for everyone.
- Stricter security rules in the browser and the desktop app block scripts that don't belong to Notevra.

## [0.11.0] — 2026-11-14

### Added
- Continue with Google when you sign in or sign up. The desktop app opens your browser and comes straight back to Notevra.
- New accounts made with Google take your Google name.
- Press Cmd/Ctrl+A, or drag across blocks, to select the whole page. Bold and Strike work on the selection.

### Changed
- Already have an account with that email? Google signs you into the same account, and signing up again with the email switches you to Sign in with it filled in.
- The sign-in window only closes with × or Esc, so a stray click outside doesn't lose what you typed.
- The format bar has bigger buttons, shows which styles are on, and a second click removes a style.
- "/" works in the middle of a line and keeps your words when the block changes type.
- Dragging a task onto another nests it only from the right third; anywhere else reorders.
- Single and Blank pages are now one: Blank.
- Lighter selection colours.

### Fixed
- The page Contents list shows plain text instead of markdown symbols.
- Archive and Trash counts match what the Archive window shows.
- The selection toolbar's Done button and the import progress bar look right again.

## [0.10.0] — 2026-11-13

### Added
- Undo and redo on a page: buttons at the top, or Ctrl/Cmd+Z and Ctrl+Y.
- Give any block its own text or background colour.
- Paste images, screenshots, and image or video links straight into a page. A "Paste as" menu lets you choose embed, link or bookmark.
- Copy an image block as a picture. Ctrl+Shift+V pastes plain text.
- Pick your font in Settings → Appearance: Plus Jakarta Sans, Inter, Lora or JetBrains Mono.
- "Blank page" in the New page dialog, now the default, and "Turn into" in the page menu.
- Delete a project forever from Trash. Empty trash clears projects too.

### Changed
- New sidebar: Search, Today and Inbox at the top, Personal and Projects as equal sections, your account at the bottom. Each section has its own "+".
- Press Delete on a page or project in the sidebar to move it to Trash, with Undo.
- Deleting blocks is instant, with an Undo bar. Delete or Backspace removes selected blocks.
- Block text lines up with the page title; the drag handle sits in the margin and hover actions float above the block.
- Toggle lists show a placeholder instead of "Hidden detail" text, and Enter moves into their lines.
- One set of line icons across the app in place of emoji.
- "Needs your decision" is now "Review changes".

### Fixed
- Restoring something you deleted now syncs to your other devices.

## [0.9.1] — 2026-10-30

### Changed
- Updates to how the Mac and Windows apps are built. Nothing changes inside the app.

## [0.9.0] — 2026-10-30

### Fixed
- Settings on phones and tablets: every section is now reachable from a row of tabs, not just Profile.

### Changed
- The developer-only Sync diagnostics and "Stage a conflict" cards are hidden. Changes needing your decision still show.

## [0.8.0] — 2026-10-30

### Added
- Pin pages: right-click a page → 📌 Pin to top. In a shared project the pin shows for everyone.
- Pin up to 5 tasks to the top of an Archive list or the Inbox with the 📌 Pin button.
- Paste markdown from Slack, GitHub or ChatGPT into an empty line and it turns into lists, tasks, quotes, headings, code blocks and dividers. Works for single lines and on Archive pages too.
- Pages remember where you scrolled.

### Changed
- Enter on an empty last list item ends the list.
- Typing "[x] " starts a ticked task.
- Sidebar: Personal first, then projects on their own panel under a Projects heading.
- Members can right-click a project to see what they can do in it.
- The sync line under your workspace name is shorter; point at it for the full message.

## [0.7.0] — 2026-10-07

### Added
- Formatting shows as you type. Write **bold** and it turns bold straight away; the marks like ** disappear and only come back, faintly, when your cursor is on those words.
- Strikethrough with ~~text~~, the S button or Cmd+Shift+X. It works in Bengali too, even with spaces inside the marks.
- _Italic_ with underscores as well as stars. Words like snake_case stay as typed.
- Links: write [text](https://…), paste a bare https:// address, or use the link button (Cmd+Shift+U). Point at a link for a card with Open, Copy, Edit and Remove; Cmd-click (Ctrl-click on Windows) opens it straight away.
- Inline code with Cmd+E.
- Line shortcuts: start an empty line with "- ", "1. ", "[] ", "> ", "# ", "```" or "---" to turn it into a list, task, quote, heading, code block or divider. Cmd+Z straight after gives you back what you typed.
- Undo and redo (Cmd+Z / Cmd+Shift+Z) in formatted text, including formatting changes.

### Changed
- Formatting now also works in sub-tasks, Archive items and their titles, list items and toggles.
- A block's edit, size, copy and delete buttons appear only once the block has something in it.
- The format buttons put the marks around the word itself, even when your selection took the space after it.

## [0.6.0] — 2026-10-02

### Added
- Invite people by email from a project's Share dialog. Someone new gets an email to sign up; someone who already has an account gets the invite in the app. Invites expire after 14 days.
- See and cancel pending invites in the Share dialog.
- Invite from the sidebar too: the person-plus button on a project, or right-click → Invite people.
- A notification bell in the page header tells you when you're invited, and when someone accepts or declines your invite.
- Settings → Notifications now works: turn notifications on or off, get due-date reminders at a time you choose, show or hide the bell, and pick how sync conflicts alert you (banner, banner with sound, or quiet). These settings are per device.
- Tag colours: every tag gets a colour that suits light and dark themes, and you can pick your own. Settings → Tags shows how often each tag is used and lets you recolour, rename or merge tags. Chosen colours sync across your devices.
- Superscript and subscript (x², H₂O) on the format bar, or with Cmd+Shift+. and Cmd+Shift+,.
- Text size per block: Small, Normal or Large from the Aa control.
- "Undo my change" in Settings → Sync & Storage puts the shared copy back when a change you made wasn't allowed.

### Changed
- Members of a shared project can still add pages, but can no longer rename or delete the project, invite people or change its tag colours. Only admins can.

## [0.5.0] — 2026-09-29

### Added
- Import your Google Keep notes: Settings → Import takes a Google Takeout .zip as well as a Notevra .json. Each note becomes a page in Personal, tagged Google Keep and its labels, with checklists as tasks, links as bookmarks and images kept.
- Trashed Keep notes are skipped and archived ones stay archived. Importing the same zip again only adds what's missing.

## [0.4.0] — 2026-09-29

### Changed
- The Downloads chart on the website now shows real counts from every visitor, not only your own browser. Each browser counts once per platform, so installing on your Mac, Android and iPhone adds three.

### Fixed
- Format buttons no longer pile up: pressing the same one again removes it, and a different one replaces it, instead of giving ****text**** or turning bold into italic.
- Inline code now shows as a highlighted chip, so it no longer looks like plain text.
- Settings → About shows the app's real version instead of v0.0.0.

## [0.3.1] — 2026-09-28

### Added
- The Mac and Windows apps tell you when a new version is out and update themselves with one click, with no new download or Terminal step. Apps on 0.2.0 or older need to download 0.3.1 by hand once.

## [0.2.0] — 2026-09-28

### Added
- Share a Personal page by moving it into a project, new or existing, straight from its Share button. Archive pages have a Share button too.
- Reset this device: Settings → Sync & Storage clears this device's copy and downloads your account again. You need to be signed in and online.

### Fixed
- A page trashed before it ever synced no longer leaves changes stuck "waiting to sync" forever.

## [0.1.1] — 2026-09-28

### Added
- Show or hide your password with the eye button when signing in, signing up or setting a new password.
- Sign-up asks for your password twice, so a typo can't lock you out of a new account.
- New sign-up and password-reset emails in Notevra's look.

### Fixed
- Your name could stay blank on Android after signing in, stuck on "saving to your account…". It now loads, and catches up when you come back to the app.

## [0.1.0] — 2026-09-28

The first numbered release.

### Added
- Notes that work fully offline and sync across every device you sign in on.
- Three kinds of page: Single, Planning and Archive, with tasks, subtasks, bold, italic, code and a Text area block.
- Today shows the pages you changed, alongside an Inbox in the sidebar.
- Snooze a task and it comes back with a tone and a notice.
- Version history: see earlier versions of a page and restore one.
- Projects in the sidebar: create, rename, and delete to the Trash.
- Share a project with someone by their display name, as Admin, Member or Guest.
- Invitations: nobody joins a project until they accept, and you can decline or leave at any time.
- Choose a display name at sign-up; it's unique, so people can find you.
- When the same thing is edited in two places, you choose: keep mine, keep theirs, keep both, or merge by hand.
- Install Notevra on iPhone, Android, Mac or Windows from the website, with a download for Mac (.dmg) and Windows (.exe).

### Changed
- BlocNote is now called Notevra.

### Security
- Guests can read a shared project but not change it, and only an admin can delete a page or rename a project.

### Fixed
- Changes could occasionally fail to reach your other devices when two people saved at the same moment.
