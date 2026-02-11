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
- Import transactions from AIB, Revolut or any bank with our AI import tool
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

## Project Structure

```
├── app/                   # Screens & routes (Expo Router)
│   ├── auth/              # Authentication screens
│   ├── import/            # Transaction import flows
│   ├── (main)/            # Main app screens
│   └── _layout.tsx        # Root layout & navigation
├── components/            # Reusable UI components
├── constants/             # App constants and configuration
├── hooks/                 # Custom React hooks
├── lib/                   # Utilities and services
│   ├── appwrite.ts        # Backend service integration
│   ├── csvParser.ts       # CSV transaction parsing
│   ├── categorization.ts  # Transaction categorization
│   └── ...
├── store/                 # Zustand state stores
├── types/                 # TypeScript type definitions
├── assets/                # Images, fonts, icons
├── docs/                  # Documentation & legal
└── scripts/               # Build and utility scripts
```

## Environment Variables

Create a `.env.local` file in the root directory (see `.env.example`):

```env
# Appwrite configuration
EXPO_PUBLIC_APPWRITE_ENDPOINT=https://your-appwrite-instance.com/v1
EXPO_PUBLIC_APPWRITE_PROJECT_ID=your-project-id
APPWRITE_API_KEY=your-server-api-key

# Sentry error tracking (optional)
SENTRY_AUTH_TOKEN=your-sentry-token
```

**Note:** Variables prefixed with `EXPO_PUBLIC_` are visible to the client. Keep sensitive keys in non-prefixed variables or backend-only services.

## Features in Development

- 📱 Android app (Expo Go)
- 🌐 Web dashboard
- 💳 Direct bank integrations
- 📧 Email receipt parsing
- 🤖 AI-powered spending recommendations
- 👥 Shared budgets with family/partners

## Privacy & Security

- 🔐 All data is encrypted and stored securely
- 🚫 We don't sell or share your data
- 📖 See our [Privacy Policy](https://george-oconnor.github.io/budget-app/privacy.html)
- 🆘 [Support & Help](https://george-oconnor.github.io/budget-app/support.html)

## License

© 2026 George O'Connor. All rights reserved.

## Support

- 📧 Report bugs or request features via GitHub Issues
- 🐛 Email: george@georgeoc.com
- 🌐 Website: https://george-oconnor.github.io/budget-app/

---

Made with ❤️ to help you take control of your finances.