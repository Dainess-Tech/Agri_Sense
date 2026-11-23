# Git & GitHub workflow for the AgriSense team (Ubuntu)

Your partner already created the GitHub repository, so **clone (pull) it first**, put the project files inside it, then push. That way you keep her history (README, licence, etc.) and avoid "unrelated histories" errors.

Replace `PARTNER_USERNAME/agrisense` below with the real repository path.

---

## 1. One-time setup on Ubuntu

```bash
# Git, curl, build tools
sudo apt update
sudo apt install -y git curl build-essential

# Node.js 22 LTS via nvm (recommended over apt's old Node version)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
node -v   # should print v22.x

# PostgreSQL 16 (or use Docker — see README)
sudo apt install -y postgresql postgresql-contrib
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
sudo -u postgres createdb app_db

# Tell Git who you are (use the email of your GitHub account)
git config --global user.name  "Your Name"
git config --global user.email "you@example.com"
git config --global init.defaultBranch main
git config --global pull.rebase false
```

## 2. Connect to GitHub with an SSH key (once per computer)

```bash
ssh-keygen -t ed25519 -C "you@example.com"     # press Enter to accept defaults
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
cat ~/.ssh/id_ed25519.pub                       # copy the whole line
```

GitHub → your avatar → **Settings → SSH and GPG keys → New SSH key** → paste → Save.

```bash
ssh -T git@github.com     # answer "yes"; you should see "Hi <username>! You've successfully authenticated"
```

> Your partner must add you as a collaborator: repo → **Settings → Collaborators → Add people**. Accept the email invitation, otherwise `git push` returns *permission denied*.

## 3. Clone your partner's repository FIRST

```bash
mkdir -p ~/projects && cd ~/projects
git clone git@github.com:PARTNER_USERNAME/agrisense.git
cd agrisense
git log --oneline      # see what she already committed
ls -la                 # e.g. README.md, .gitignore, LICENSE
```

## 4. Copy the AgriSense project into the clone

Download/export this project (zip), then copy everything **except** `node_modules`, `.next` and `.env`:

```bash
# assuming the project was extracted to ~/Downloads/agrisense-app
rsync -av --progress \
  --exclude node_modules --exclude .next --exclude .env --exclude .git \
  ~/Downloads/agrisense-app/ ~/projects/agrisense/
```

If your partner already had a `README.md` or `.gitignore`, rsync overwrites them — open them and merge anything important back in (`git diff README.md` shows what changed).

## 5. Install, configure and run locally

```bash
cd ~/projects/agrisense
cp .env.example .env            # edit DATABASE_URL if your Postgres differs
npm install
npx drizzle-kit push            # creates all tables in app_db
npm run dev                     # http://localhost:3000
```

The first account you register becomes the **admin**.

## 6. First commit & push

```bash
git status                      # .env and node_modules must NOT appear (they're in .gitignore)
git add .
git commit -m "chore: AgriSense project structure — Next.js PWA, API v1, Drizzle schema, prediction engine, ESP32 firmware"
git push origin main
```

If `git push` is rejected because your partner pushed in the meantime:

```bash
git pull origin main            # merges her changes; fix conflicts if Git asks
git push origin main
```

> **Already have a local folder that isn't a clone?** Inside it run:
> `git init && git remote add origin git@github.com:PARTNER_USERNAME/agrisense.git && git pull origin main --allow-unrelated-histories`
> then resolve conflicts, commit and `git push -u origin main`.

## 7. How your partner gets the code

```bash
git clone git@github.com:PARTNER_USERNAME/agrisense.git   # first time
# or, if she already has it:
git checkout main && git pull origin main
npm install && cp .env.example .env && npx drizzle-kit push && npm run dev
```

Frontend work lives in `src/app/(app)/*` (pages), `src/components/*` (UI) and `src/lib/client/*` (API client, offline queue, hooks). See `docs/ARCHITECTURE.md`.

## 8. Daily workflow (feature branches + pull requests)

```bash
git checkout main && git pull                       # always start from the latest main
git checkout -b feature/frontend-dashboard-charts   # one branch per task
# ...work...
git add -A && git commit -m "feat(dashboard): add soil moisture trend chart"
git push -u origin feature/frontend-dashboard-charts
```

Open a **Pull Request** on GitHub → your partner reviews → **Merge**. Then everyone runs `git checkout main && git pull`.

Suggested branch prefixes: `feature/`, `fix/`, `docs/`, `firmware/`, `engine/`.
Commit style: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`.

Protect `main`: repo → **Settings → Branches → Add rule → main → Require a pull request before merging**.

## 9. Ownership to avoid stepping on each other

| Area | Folders | Owner |
|------|---------|-------|
| Frontend / PWA | `src/app/(app)`, `src/app/auth`, `src/components`, `src/lib/client`, `public/` | Partner |
| Backend / API / DB | `src/app/api/v1`, `src/server`, `src/db` | You |
| Agricultural intelligence | `src/modules/prediction-engine`, `src/modules/risk-engine` | Shared |
| IoT | `firmware/esp32`, `src/modules/iot`, `scripts/simulate-device.mjs` | You |
| Contracts | `docs/API.md`, `src/db/schema.ts` | Agree together before changing |

## 10. Useful commands

```bash
git status / git diff              # what changed
git log --oneline --graph -15      # history
git restore <file>                 # discard local changes to a file
git stash / git stash pop          # park work temporarily
git branch -d feature/x            # delete merged branch
```
