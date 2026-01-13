# Loaded - Personal Budgeting

A smart, intuitive personal budgeting app built with React Native and Expo. Take control of your finances by tracking spending, setting budgets, and gaining insights into your money with our secure, ad-free budget tracker.

**Download on App Store:** [Loaded - Personal Budgeting](https://apps.apple.com/us/app/loaded-personal-budgeting/id6756985580)

## Overview

Loaded is designed to help you:
- 💰 **Track your spending** across multiple accounts in real-time
- 📊 **Set and manage budgets** by category with smart alerts
- 📈 **Visualize your finances** with interactive charts and analytics
- 🔒 **Keep your data secure** with encryption and no tracking
- 🏦 **Import transactions** from AIB, Revolut, or CSV files
- 🧠 **Auto-categorize transactions** with AI-powered merchant recognition

## Key Features

### Smart Budget Management
- Set monthly budgets by category
- Real-time spending tracking
- Visual spending patterns
- Alerts when approaching budget limits

### Comprehensive Analytics
- Interactive spending charts and graphs
- Category-based expense tracking
- Income vs. expense comparisons
- Spending trends over time

### Multi-Account Support
- Track multiple bank accounts and balances
- Import transactions from AIB and Revolut
- CSV import for easy data migration
- Automatic transaction synchronization

### Smart Categorization
- AI-powered merchant recognition
- Custom category creation
- Bulk transaction editing
- Quick filters and search

### Security & Privacy
- End-to-end encrypted data
- No ads, no tracking
- Biometric authentication support
- Cloud sync across devices

### Beautiful & Intuitive
- Clean, modern interface
- Dark mode support
- Customizable spending categories
- Easy transaction entry

## Tech Stack

- **Framework:** React Native with Expo
- **Language:** TypeScript
- **Routing:** Expo Router (file-based)
- **State Management:** Zustand
- **Styling:** NativeWind + Tailwind CSS
- **Backend:** Appwrite
- **Monitoring:** Sentry
- **Parsing:** CSV parsing for transaction imports

## Getting Started

### Requirements

- Node.js (v18+ recommended)
- npm or yarn
- iOS Simulator (Xcode) or Android Emulator (optional)
- Expo CLI (installed automatically with `npx`)

### Installation

```bash
# Clone the repository
git clone https://github.com/george-oconnor/budget-app.git
cd budget-app

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env.local
# Edit .env.local with your API keys and configuration
```

### Development

```bash
# Start the Expo dev server
npm start

# Or use tunnel mode for remote testing
npx expo start --tunnel

# Alternative modes
npx expo start --lan      # Local network only
npx expo start --localhost # Localhost only

# Run on specific platforms
npm run ios               # iOS simulator
npm run android           # Android emulator
npm run web               # Web browser
```

**Keyboard shortcuts** (when dev server is running):
- `i` - Open iOS Simulator
- `a` - Open Android Emulator
- `w` - Open web version
- `r` - Reload app
- `m` - Toggle menu

## Project Structure

```
├── app/                    # Screens & routes (Expo Router)
│   ├── auth/              # Authentication screens
│   ├── import/            # Transaction import flows
│   ├── (main)/            # Main app screens
│   └── _layout.tsx        # Root layout & navigation
├── components/            # Reusable UI components
├── constants/             # App constants and configuration
├── hooks/                 # Custom React hooks
├── lib/                   # Utilities and services
│   ├── appwrite.ts       # Backend service integration
│   ├── csvParser.ts      # CSV transaction parsing
│   ├── categorization.ts # Transaction categorization
│   └── ...
├── store/                 # Zustand state stores
├── types/                 # TypeScript type definitions
├── assets/                # Images, fonts, icons
├── docs/                  # Documentation & legal
└── scripts/              # Build and utility scripts
```

## Environment Variables

Create a `.env.local` file in the root directory (see `.env.example`):

```env
# Appwrite configuration
EXPO_PUBLIC_APPWRITE_ENDPOINT=https://your-appwrite-instance.com/v1
EXPO_PUBLIC_APPWRITE_PROJECT_ID=your-project-id
EXPO_PUBLIC_APPWRITE_API_KEY=your-api-key

# Sentry error tracking (optional)
SENTRY_AUTH_TOKEN=your-sentry-token
```

**Note:** Variables prefixed with `EXPO_PUBLIC_` are visible to the client. Keep sensitive keys in non-prefixed variables or backend-only services.

## Available Scripts

```bash
npm start                 # Start Expo dev server
npm run ios              # Build and run on iOS simulator
npm run android          # Build and run on Android emulator
npm run web              # Run web version
npm run lint             # Run ESLint
npm run seed:demo        # Seed demo user data (development)
npm run reset-project    # Reset to clean state
```

## Features in Development

- 📱 Android app (Expo Go)
- 🌐 Web dashboard
- 💳 Direct bank integrations
- 📧 Email receipt parsing
- 🤖 AI-powered spending recommendations
- 👥 Shared budgets with family/partners

## Contributing

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make your changes and test thoroughly
3. Commit with clear messages: `git commit -m "Add feature: description"`
4. Push and open a pull request

## Privacy & Security

- 🔐 All data is encrypted and stored securely
- 🚫 We don't sell or share your data
- 📖 See our [Privacy Policy](https://george-oconnor.github.io/budget-app/privacy.html)
- 🆘 [Support & Help](https://george-oconnor.github.io/budget-app/support.html)

## Troubleshooting

### Tunnel Connection Timeout
If `expo start --tunnel` times out, try alternative modes:
```bash
npx expo start --lan      # Recommended for local testing
npx expo start --localhost
```

### Metro Bundler Issues
Clear cache and restart:
```bash
npx expo start --clear
```

### Dependencies Issues
Reinstall dependencies:
```bash
rm -r node_modules package-lock.json
npm install
```

## License

© 2026 George O'Connor. All rights reserved.

## Support

- 📧 Report bugs or request features via GitHub Issues
- 🐛 Email: support@loadedapp.com
- 🌐 Website: https://george-oconnor.github.io/budget-app/

---

Made with ❤️ to help you take control of your finances.

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
