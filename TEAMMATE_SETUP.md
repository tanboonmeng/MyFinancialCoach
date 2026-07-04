# Team setup guide — My Financial Coach

Welcome to the **Alpha Minds** project repo. This guide gets you from zero to
editing the site in about 5 minutes. No build tools needed — it's plain HTML,
CSS, and JavaScript.

Repo: https://github.com/tanboonmeng/MyFinancialCoach

---

## 1. One-time prerequisites

Before you can clone, make sure you have:

- **A GitHub account** — sign up free at https://github.com if you don't have one.
- **Accepted the repo invite** — Boon Meng will add you as a collaborator.
  Check your email (or https://github.com/notifications) and click
  **Accept invitation**. You can't push until you accept.
- **Git installed** on your computer:
  - Windows: download from https://git-scm.com/download/win and install with
    the default options.
  - Mac: run `git --version` in Terminal — if it's missing, macOS will offer to
    install it.
  - Check it worked: open a terminal and run `git --version`.

---

## 2. Clone the repo

Open a terminal (on Windows: **Git Bash** or **PowerShell**), move to where you
keep your projects, and run:

```bash
git clone https://github.com/tanboonmeng/MyFinancialCoach.git
cd MyFinancialCoach
```

**First time you push**, GitHub will ask you to sign in — a browser window opens,
just log in and authorize. (If it asks for a password in the terminal, use a
**Personal Access Token**, not your account password — GitHub no longer accepts
passwords for git. Create one at https://github.com/settings/tokens.)

---

## 3. Open / preview the site

It's a static site, so there's nothing to install or build:

- **Just double-click `index.html`** to open it in your browser, **or**
- For live-reload while editing, use VS Code's **Live Server** extension
  (right-click `index.html` → *Open with Live Server*).

---

## 4. The files (who owns what)

| File          | What it is                            | Owner              |
|---------------|---------------------------------------|--------------------|
| `index.html`  | Landing page (marketing + onboarding) | shared             |
| `app.html`    | Workspace: dashboard + coach chat     | shared             |
| `style.css`   | All branding & styles (both pages)    | shared             |
| `site.js`     | UI behaviour (nav, onboarding, dash)  | shared             |
| `app.js`      | MAS calculation logic (to be added)   | **Ryan**           |

The `.txt` files are our spec/handoff sheets — please **don't edit or delete**
them; they're our source of truth.

---

## 5. Everyday workflow (please follow this)

To avoid overwriting each other's work, use a branch for your own piece instead
of editing `main` directly.

```bash
# 1. Always start from the latest code
git checkout main
git pull

# 2. Make your own branch (name it after your piece)
git checkout -b ryan-app-js        # e.g. Ryan; or ezann-onboarding, etc.

# 3. ...do your edits...

# 4. Save your work
git add -A
git commit -m "Add MAS calculation logic to app.js"

# 5. Push your branch
git push -u origin ryan-app-js
```

Then go to the repo on GitHub and open a **Pull Request** to merge your branch
into `main`. That way we can all see each other's changes before they land.

**Suggested branch names:**
- Ryan → `ryan-app-js`
- Sammi → `sammi-botpress-embed`
- Rainie → `rainie-telegram`
- Ezann → `ezann-onboarding`

---

## 6. Getting unstuck

- `git pull` says *conflict*? Don't panic — message the group and we'll resolve
  it together.
- Push rejected? Run `git pull` first, then push again.
- Not sure? It's very hard to lose committed work in git — ask before force-doing
  anything (never run `git push --force` on `main`).

Questions → ping the Alpha Minds group chat.
