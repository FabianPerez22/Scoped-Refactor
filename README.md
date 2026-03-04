# Scoped Refactor

`Scoped Refactor` is a VS Code extension for fast, targeted text refactors across your workspace.

## Language Support

`Scoped Refactor` works on text files across different languages, including:

- Python (`.py`)
- JavaScript (`.js`)
- TypeScript (`.ts`)
- React / JSX (`.jsx`)
- React / TSX (`.tsx`)
- Java (`.java`)
- And other source files in your workspace

It is language-agnostic (text-based), so it can be used broadly in mixed codebases.

## What It Does

- Supports 3 actions:
  - `Add before to...`
  - `Remove all...`
  - `Edit all...`
- Lets you define one or more targets (with `+` / `-` controls).
- Lets you define path rules (with `+` / `-` controls):
  - `Ignore path`
  - `Only modify this path`
- Supports path patterns:
  - Folder pattern: `src/generated/*`
  - Exact file path: `src/game/Player.java`
  - File name only: `Player.java`
- Includes `Validate results` to preview how many matches/files would be affected.
- Shows results in a bottom result box inside the extension view.
- Skips replacements inside comments (`//`, `/* ... */`, and `#` line comments).
- Avoids duplicate prefix insertion when using `Add before to...`.

## How It Works

1. Open `Scoped Refactor` from the Activity Bar.
2. Choose an action (`Add before`, `Remove all`, or `Edit all`).
3. Provide:
   - Action text (required for `Add before` and `Edit all`)
   - One or more targets
   - Optional path rules
4. Click `Validate results` to preview.
5. Click `Confirm` to apply changes.

## Best Use Cases

- Refactoring many repeated identifiers quickly.
- Applying controlled replacements in selected files/folders.
- Bulk cleanup or migration tasks while keeping comments untouched.

## Examples

- Java: Add `instance.` before target `life` across classes.
- TypeScript/React: Edit all `oldApi` to `newApi` in selected folders.
- Python: Remove all uses of a deprecated token outside comments.
