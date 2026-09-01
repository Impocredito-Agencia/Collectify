# Collectify

WhatsApp-based automated overdue payment reminder system for lending companies. Replaces the manual process of reviewing an Excel sheet and sending messages one by one with a backend that calculates overdue days automatically and a CronJob that sends messages weekly.

## Stack

| Layer | Technology |
|---|---|
| Backend | NestJS + TypeORM + PostgreSQL |
| Frontend | React + Vite + Tailwind CSS |
| Messaging | Meta Cloud API (WhatsApp Business) |
| Infrastructure | Railway (backend + DB) · Cloudflare Workers, static assets (frontend) |
| Local database | PostgreSQL via Docker |

## Repository structure

This is a **monorepo**. Backend and frontend live in the same repository, in separate folders:

```
collectify/
├── apps/
│   ├── api/           # REST API — NestJS
│   └── client/        # Web panel — React + Vite
├── docs/              # Project documentation (this file and the rest)
└── README.md
```

## Prerequisites

Before cloning, make sure you have installed:

- **Node.js 22 LTS** — [download here](https://nodejs.org)
- **npm** (comes bundled with Node)
- **Docker** and **Docker Compose** — to run PostgreSQL locally
- **Git**

Check your versions:

```bash
node -v   # should show v22.x.x
npm -v
docker -v
```

## Running the project locally

### 1. Clone the repository

```bash
git clone https://github.com/<org>/collectify.git
cd collectify
```

### 2. Start the database with Docker

```bash
docker compose up -d
```

This spins up a PostgreSQL container on port `5432`. Verify it's running:

```bash
docker ps
```

### 3. Set up and run the API

```bash
cd apps/api
npm install
cp .env.example .env    # fill in the variables — see ENVIRONMENT_VARIABLES.md
npm run migration:run   # run TypeORM migrations
npm run start:dev
```

The API runs at `http://localhost:3000`. There's no self-registration —
create the first admin account with:

```bash
npm run seed:admin -- "Full Name" admin@example.com "a-strong-password"
```

### 4. Set up and run the Client

In a separate terminal:

```bash
cd apps/client
npm install
cp .env.example .env.local   # fill in the variables
npm run dev
```

The client runs at `http://localhost:5173` (Vite's default port).

### 5. Run the tests

```bash
# API
cd apps/api
npm run test          # unit tests
npm run test:cov      # with coverage report

# Client
cd apps/client
npm run test
```

## Project documentation

All detailed documentation lives in the [`/docs`](./docs) folder:

| Document | Content |
|---|---|
| [`CONTRIBUTING.md`](./docs/CONTRIBUTING.md) | Branching rules, commit conventions, and PR process |
| [`ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Folder structure and design decisions |
| [`CODING_STANDARDS.md`](./docs/CODING_STANDARDS.md) | Code conventions for backend and frontend |
| [`TESTING.md`](./docs/TESTING.md) | Unit testing strategy and standards |
| [`DATABASE.md`](./docs/DATABASE.md) | Data model and database conventions |
| [`ENVIRONMENT_VARIABLES.md`](./docs/ENVIRONMENT_VARIABLES.md) | Environment variables explained |
| [`DEFINITION_OF_DONE.md`](./docs/DEFINITION_OF_DONE.md) | Checklist before merging any task |
| [`GLOSSARY.md`](./docs/GLOSSARY.md) | Business vocabulary (overdue, installment, collector, etc.) |
| [`PROJECT_ROADMAP.md`](./docs/PROJECT_ROADMAP.md) | High-level development phases |

Day-to-day tasks are managed in **Jira**, not in this repository. Every commit and PR must reference its Jira ticket ID (e.g. `COL-23`).

## License

Private — Exclusive property of the client. Usage restricted to the development team assigned to this project.
