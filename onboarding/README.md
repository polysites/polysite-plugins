# Setup checklist

A "Get your site ready" card on the admin dashboard that walks a new site, or a new editor, through the first things worth doing. It
ticks itself where Polysite can see the answer, can be dismissed, and remembers its state **per site**.

**Scope:** global. It is on for every site as soon as the plugin is installed.

## What people see

The card lists only the steps that person can act on, so an editor is not asked to do something their role forbids.

| Step | Ticks itself when | Shown to |
| --- | --- | --- |
| Add your logo | the site has a logo | people who may change the site's settings |
| Add a menu | the site has at least one header link | people who may change the site's settings |
| Connect your domain | the site's domain is a real hostname (not `localhost`, `.local`, `.test`, `.example` or a bare address) | people who may change the site's settings |
| Add a page of your own | the site has a page other than the home page | roles that can create pages |
| Upload a picture | the site's media library is not empty | roles that can create media |
| Add a form | the site has a form | roles that can create forms |
| Learn how drafts and publishing work | **ticked by hand** | everyone |
| Invite an editor | an account other than a Super Admin is assigned to the site | Super Admins (only they can list or create accounts) |
| Turn on backups | **ticked by hand**: backups run on the server, where the CMS cannot see | Super Admins |

Each step links to the admin page where it is done. A "Mark done" button appears on the by-hand steps.

**Dismiss the checklist** hides it for everyone on that site, and leaves a small "Show the setup checklist" link so it can be brought back.
When every step is done the card says so and offers to close. A person who works on several sites and has not picked one in the site
switcher sees a one-line prompt to choose; a person with a single site is taken to that one.

## How it works

- It reads with the signed-in person's own session through the normal API (`/api/users/me`, `/api/sites/:id`, and counts on pages, forms,
  media and users), so it can never show more than that person may see. A count they may not read leaves that step unticked.
- Its state is one row per site in its own table, `onboarding-progress` (`dismissed`, and `doneByHand`, the ids of the by-hand steps
  ticked). The core scopes the table to a site; nothing is added to Sites, Users or any other core table.
- No field of it reaches the public site (`publicFields` is empty). The row is not shown in the admin menu.
- Anyone signed in can update the row of a site they belong to, since dismissing a checklist is not a site setting; only a Super Admin can delete one.

## Why a plugin, not part of the core

It needs a table of its own, the core does not depend on it, and a team that does not want a checklist can leave the folder out. The
steps themselves are a list in `src/checklist.js`; adding one is one entry there.

## Install and remove

Drop the folder into the plugins directory and restart the CMS, as for any plugin. In production its migration creates the table
(`migrations/`). Removing the plugin, or listing it in `POLYSITE_PLUGINS_OFF`, hides the card and keeps the table.

## For developers

```text
src/index.js            the plugin: the onboarding-progress collection and the dashboard card
src/checklist.js        the steps, who sees each, how each ticks, the site cookie parser (pure functions, tested)
src/admin/Checklist.js  the card (plain React, no JSX)
migrations/             the table
test/checklist.test.js  node --test test/*.test.js, inside the CMS container
```

To change what a step checks, edit its `done` function. A step has `who` (`settings`, `pages`, `forms`, `media`, `super` or `anyone`), a `label`,
a `hint`, an admin `href` and/or a `docs` link, and either a `done(facts)` function or `manual: true`.
