<a id="readme-top"></a>

[![Contributors][contributors-shield]][contributors-url]

<br />
<div align="center">
  <a href="https://github.com/mors-incarnatum/WiKahon">
    <img src="images/logo.png" alt="WiKahon Logo" width="80" height="80">
  </a>

  <h3 align="center">WiKahon</h3>

  <p align="center">
    Tap &amp; Scribble AAC Taglish communicator for non-verbal children

  </p>
</div>

<!-- ABOUT THE PROJECT -->
## About The Project

**WiKahon** is an Augmentative and Alternative Communication (AAC) board designed for children communicating in Taglish. It combines tap-based symbol boards with scribble/handwriting input and offline-first support.

### Built With

* [![Next][Next.js]][Next-url]
* [![React][React.js]][React-url]
* [![TypeScript][TypeScript]][TypeScript-url]
* [![TailwindCSS][TailwindCSS]][TailwindCSS-url]
* [![Supabase][Supabase]][Supabase-url]
* [![Zustand][Zustand]][Zustand-url]
* [![Tesseract.js][Tesseract.js]][Tesseract-url]
* [![Vitest][Vitest]][Vitest-url]

<!-- PROJECT STRUCTURE -->
## Project Structure

```text
WiKahon/
├── docs/                 # Research and project documentation
├── images/               # README assets (logo.png)
└── seals/                # Next.js web application
    ├── app/              # Next.js App Router pages, components, and API routes
    ├── models/           # Domain models
    ├── public/           # Static assets, symbols, and service worker (sw.js)
    ├── services/         # Application and Supabase services
    ├── store/            # Zustand state stores
    ├── supabase/         # Supabase SQL migrations
    └── viewmodels/       # MVVM view models
```

<!-- GETTING STARTED -->
## Getting Started

### Prerequisites

* Node.js &amp; npm
* A [Supabase](https://supabase.com/) project

### Installation

1. Clone the repo
   ```sh
   git clone https://github.com/mors-incarnatum/WiKahon.git
   ```
2. Go to the app directory
   ```sh
   cd WiKahon/seals
   ```
3. Install NPM packages
   ```sh
   npm install
   ```
4. Apply the SQL migrations in `seals/supabase/migrations/` to your Supabase project.
5. Create `seals/.env.local` and add your Supabase settings:
   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```
   `SUPABASE_SERVICE_ROLE_KEY` is server-only. Never expose it through a
   `NEXT_PUBLIC_*` variable or commit it to source control.
6. Run the development server
   ```sh
   npm run dev
   ```
7. Open `https://localhost:3000` in your browser.
   > **Note:** `npm run dev` runs with `--experimental-https`, so your browser may ask you to accept the local self-signed certificate on first visit.

### Available Scripts

Run these from `seals/`:

* `npm run dev` — Start the Next.js development server over HTTPS
* `npm run build` — Build the production bundle
* `npm run start` — Start the production server
* `npm run lint` — Run ESLint
* `npm test` — Run the Vitest test suite

<!-- TOP CONTRIBUTORS -->
## Top Contributors

<a href="https://github.com/mors-incarnatum/WiKahon/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=mors-incarnatum/WiKahon" />
</a>

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
[contributors-shield]: https://img.shields.io/github/contributors/mors-incarnatum/WiKahon.svg?style=for-the-badge
[contributors-url]: https://github.com/mors-incarnatum/WiKahon/graphs/contributors
[product-screenshot]: images/screenshot.png
[Next.js]: https://img.shields.io/badge/next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white
[Next-url]: https://nextjs.org/
[React.js]: https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB
[React-url]: https://reactjs.org/
[TypeScript]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[TypeScript-url]: https://www.typescriptlang.org/
[TailwindCSS]: https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white
[TailwindCSS-url]: https://tailwindcss.com/
[Supabase]: https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white
[Supabase-url]: https://supabase.com/
[Zustand]: https://img.shields.io/badge/Zustand-443E38?style=for-the-badge&logo=react&logoColor=white
[Zustand-url]: https://zustand-demo.pmnd.rs/
[Tesseract.js]: https://img.shields.io/badge/Tesseract.js-3A5B7C?style=for-the-badge
[Tesseract-url]: https://tesseract.projectnaptha.com/
[Vitest]: https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white
[Vitest-url]: https://vitest.dev/
