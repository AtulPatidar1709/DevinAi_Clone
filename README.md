# Devine AI Clone — GitHub Auth + Sessions + Docker Sandbox

This version keeps the existing agent/sandbox implementation and adds the product flow around it:

- GitHub App based login
- Persistent Devine session cookie
- Global GitHub repository access page
- Selective repository access through a GitHub App installation
- Add repositories from both the Repositories page and the chat composer
- Create a session/workspace from a connected repository
- Create a Docker sandbox and clone the selected private/public repository
- Chat with the existing coding agent through SSE
- Right-side Overview / Code / Shell panel
- Existing `/api/agent/*` endpoints are preserved and protected by authentication

## Important design decision

GitHub authorization is **not attached to a sandbox**.

```text
GitHub login
    ↓
GitHub App installation
    ↓
Global repository access
    ↓
Connected repository
    ↓
Session / Workspace
    ↓
Docker sandbox
    ↓
Existing agent
```

A user can create many sessions/sandboxes for the same authorized repository without another GitHub authorization flow.

The GitHub App installation controls which repositories Devine can access. The app can be installed with **All repositories** or **Only select repositories**. The repository page is the global place where the user manages that access.

## Prisma structure

This project intentionally keeps your Prisma 7 setup and `prisma.config.ts` pattern. The only change is using Prisma 7 multi-file schema support:

```text
packages/db/prisma/
├── schema.prisma          # generator + datasource
├── models/
│   ├── auth.prisma
│   ├── repository.prisma
│   └── workspace.prisma
└── migrations/
```

`prisma.config.ts` points at `packages/db/prisma/`, so Prisma loads all `.prisma` files in that directory tree.

## 1. Environment

Copy:

```bash
cp .env.example .env
```

Fill in:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/devine"

GITHUB_APP_ID=...
GITHUB_APP_CLIENT_ID=...
GITHUB_APP_CLIENT_SECRET=...
GITHUB_APP_SLUG=devine-ai-clone
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
GITHUB_CALLBACK_URL=http://localhost:3000/api/auth/github/callback
GITHUB_SETUP_URL=http://localhost:3000/api/github/setup
```

## 2. Create the GitHub App

In GitHub Developer Settings → GitHub Apps, create an app.

For local development:

- Homepage URL: `http://localhost:5173`
- Callback URL: `http://localhost:3000/api/auth/github/callback`
- Setup URL: `http://localhost:3000/api/github/setup`
- Do **not** enable "Request user authorization (OAuth) during installation" for this implementation; login uses the app's OAuth web flow separately.
- Make the app public if accounts other than the app owner will use it. For personal testing, a private app is sufficient.

Recommended permissions for this project:

### Repository permissions

- Metadata: Read-only
- Contents: Read and write

Contents write is requested now because the eventual product will push approved changes. **This code does not implement an automatic push.** The future push endpoint must require explicit user approval.

### Account permissions

- Email addresses: Read-only (optional)

The Login with GitHub flow uses the GitHub App user-authorization flow. After login, the user can install the GitHub App and choose **All repositories** or **Only select repositories**. The repository page is global, so creating another sandbox does not require another GitHub authorization flow.

## 3. Install dependencies

From the repository root:

```bash
bun install
```

## 4. Generate Prisma client

```bash
bun db:generate
```

For this auth branch, the repository includes an explicit migration at:

```text
packages/db/prisma/migrations/20260817090000_auth_and_sessions/
```

The pre-auth prototype used a different Workspace/Repository shape. The included migration intentionally recreates those prototype tables using the authenticated user-owned shape, so **existing prototype Workspace/Repository/Sandbox rows are removed**. If you need those rows, back up the database before migrating.

For a fresh database or a development database where the old prototype data can be discarded:

```bash
bun db:migrate
bun db:generate
```

If you only want Prisma to synchronize the schema during local experimentation, you can use:

```bash
bun db:push
bun db:generate
```

## 5. Build the sandbox image

```bash
bun sandbox:build
```

This image contains:

- code-server
- git
- Node.js 22
- Python 3
- curl
- a Git askpass helper for private GitHub repository cloning

## 6. Start the application

```bash
bun dev
```

Frontend:

```text
http://localhost:5173
```

Backend:

```text
http://localhost:3000
```

## Product flow

### Login

```text
Login
 ↓
Continue with GitHub
 ↓
GitHub App user authorization
 ↓
Devine session cookie
 ↓
Home
```

### Repository access

```text
Repositories
 ↓
Add repository / Manage GitHub access
 ↓
GitHub App installation
 ↓
All repositories OR Only select repositories
 ↓
Devine receives installation ID
 ↓
Devine lists repositories available to that installation
```

### New session

```text
New session
 ↓
Select repository
 ↓
Create session
 ↓
Create Docker sandbox
 ↓
Create short-lived GitHub installation token
 ↓
Clone repository
 ↓
Install dependencies
 ↓
Try to start preview
 ↓
Chat with agent
```

### Agent

The existing agent implementation remains the source of truth for:

- list files
- read files
- write files
- run commands
- application logs
- LLM tool calling
- SSE agent events

The new `/api/sessions/:id/chat/stream` endpoint simply maps a user session to the existing sandbox container and agent.

## API overview

### Authentication

```text
GET  /api/auth/github
GET  /api/auth/github/callback
GET  /api/auth/me
POST /api/auth/logout
```

### GitHub access

```text
GET  /api/github/status
GET  /api/github/install
GET  /api/github/setup
GET  /api/github/repositories
```

### Devine connected repositories

```text
GET    /api/repositories
POST   /api/repositories
DELETE /api/repositories/:id
```

`POST /api/repositories` accepts:

```json
{
  "githubId": 123456
}
```

The backend verifies that the GitHub App currently has access to that repository before storing it as a Devine repository.

### Sessions / workspaces

```text
GET    /api/sessions
GET    /api/sessions/:id
POST   /api/sessions
DELETE /api/sessions/:id
```

Create:

```json
{
  "repositoryId": "devine-repository-id",
  "name": "Change UI responsiveness"
}
```

### Chat

```text
POST /api/sessions/:id/chat
POST /api/sessions/:id/chat/stream
```

Streaming response is SSE.

### Sandbox UI helpers

```text
GET  /api/sessions/:id/files?path=.
GET  /api/sessions/:id/logs
POST /api/sessions/:id/shell
```

### Existing agent endpoints

The previous low-level endpoints remain available under:

```text
POST /api/agent/prepare
POST /api/agent/execute
POST /api/agent/tools/list-files
POST /api/agent/tools/read-file
POST /api/agent/tools/write-file
POST /api/agent/tools/run-command
POST /api/agent/tools/logs
POST /api/agent/run
POST /api/agent/run/stream
DELETE /api/agent/sandbox/:containerId
```

They are now behind authentication. The product UI uses the session endpoints instead.

## What is intentionally NOT implemented yet

The current phase stops before GitHub push.

The agent is allowed to modify the Docker sandbox, but Devine does not automatically push anything to GitHub.

The next phase should add:

```text
Sandbox changes
 ↓
git diff
 ↓
Changes UI
 ↓
User reviews
 ↓
[Approve & Push]
 ↓
Backend creates commit / branch / PR
 ↓
GitHub
```

That approval boundary should remain explicit.


## Push safety

The agent is allowed to modify files inside the Docker sandbox. This branch deliberately does **not** automatically push changes to GitHub. A future push endpoint should only execute after an explicit user confirmation from the UI. Until that endpoint is added, GitHub is used for authentication, repository discovery, installation-scoped cloning, and sandbox work only.

## Verification performed before packaging

The source tree was checked for the Prisma 7 adapter setup, workspace exports, ESM imports, GitHub authentication flow, repository/session routes, and frontend GitHub icon imports. A real `bun install`/Turbo build could not be completed in the execution environment because Bun is not installed and npm registry access timed out; therefore this archive is **not claimed to have passed a full dependency-installed build here**. Run the installation/build commands above on your Windows/Bun environment before starting the app.
