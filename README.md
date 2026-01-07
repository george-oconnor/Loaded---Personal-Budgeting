# Loaded - The Personal Budget Tracker

A React Native app built with Expo. This README provides a clean starting point for local development, environment setup, and contribution workflow.

## Requirements

- Node.js (LTS recommended)
- npm (or yarn/pnpm)
- iOS Simulator (Xcode) or Android Emulator (Android Studio), optional

## Quick Start

```bash
# install dependencies
npm install

# start the Expo dev server
npx expo start

# common shortcuts once the server is up
# i: open iOS simulator, a: open Android emulator, w: open web
```

If you prefer npm scripts, `npm start` typically runs the same dev server.

## Project Structure

- `app/`: Screens and routes (Expo Router / file-based routing)
- `assets/`: Images, fonts, static assets
- Other folders as needed for state, services, components

Develop by editing files under `app/`. Routes are inferred from the filesystem when using Expo Router.

## Environment Variables

- Local environment files are ignored by git (see `.gitignore`).
- For client-side values in Expo, prefix variables with `EXPO_PUBLIC_`.

Example `.env.example`:

```env
# Visible to the app at runtime (Expo)
EXPO_PUBLIC_API_BASE_URL=https://api.example.com

# Non-exposed values (for tooling/scripts only)
SENTRY_AUTH_TOKEN=your-token-here
```

Create your own `.env` by copying `.env.example` and adjusting values. Keep secrets out of source control.

## Useful Commands

```bash
# clear Metro/Expo cache if needed
npx expo start -c

# install a new package
npm install <package>

# run TypeScript checks (if configured)
npm run typecheck

# run tests (if configured)
npm test
```

## Contributing

Use branches and pull requests:

```bash
# create a feature branch
git checkout -b feature/your-change

# stage and commit
git add -A
git commit -m "feat: describe your change"

# push and set upstream
git push -u origin feature/your-change
```

Open a PR on GitHub and merge when reviewed.

## Troubleshooting

- Simulator not launching: ensure Xcode/Android Studio is installed and emulators are set up.
- Stale build or bundler issues: try `npx expo start -c`.
- Dependency conflicts: delete `node_modules`, reinstall, and restart the dev server.

## Notes

This README is a fresh baseline for the project. Expand it with app-specific details (architecture, state management, API docs, testing setup) as they become available.
# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.

## Contributing

Work in branches and open pull requests.

```bash
# create a feature branch
git checkout -b feature/readme-update

# stage and commit your changes
git add README.md
git commit -m "docs: add contributing section"

# push and set upstream
git push -u origin feature/readme-update
```

Then open a PR on GitHub and merge when approved.
