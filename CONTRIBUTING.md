# Contributing

Issues and pull requests are both welcome, and questions are just as welcome as
patches. If something is unclear or looks wrong, say so.

## Setup

Three package trees, each with its own lockfile:

```sh
npm install
npm run hooks
npm --prefix app install
npm --prefix electron install
```

`npm run dev` starts the browser app on http://localhost:5173. `npm run
desktop` builds it and opens the desktop shell.

## Before you open a pull request

```sh
npm run verify
```

Typecheck, the three test suites, coverage, lint, format and both builds. It is
the same list ci runs, so if it passes locally it passes there.

## Pull requests

- one thing per pull request
- say what changed and why, in a couple of sentences
- if you touched the dithering output, say which pixels moved and why that is
  the right answer
- for anything visual, a screenshot before and after

Use a conventional title, `type(scope): what it does`. `feat`, `fix`, `docs`,
`chore`, `refactor`, `test`.

## Reporting a bug

Open an issue and say what you did, what happened and what you expected. A
screenshot or a short clip helps a lot. If it needs a particular image, say
what size and format.

## Licensing

The project is GPL-3.0-only. If you bring in code or data from somewhere else,
say where it came from in your pull request so it can be credited.
