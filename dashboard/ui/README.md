# Milabench Dashboard

A modern React-based dashboard for visualizing and analyzing Milabench benchmark results.

## Features

- View execution results
- Monitor metrics in real-time
- Compare different runs
- Interactive charts and tables
- Responsive design

## Prerequisites

- Node.js 16+ and npm
- Milabench backend server running on port 5000

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

The application will be available at http://localhost:5173

## Development

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build

## Project Structure

```
src/
├── components/
│   ├── layout/      # Layout components
│   ├── common/      # Reusable components
│   └── views/       # Page components
├── services/        # API and data services
├── hooks/          # Custom React hooks
└── utils/          # Utility functions
```

## API Integration

The dashboard communicates with the Milabench backend server through the following endpoints:

- `/api/exec/list` - List all executions
- `/api/exec/<id>/packs` - Get packs for an execution
- `/api/exec/<id>/packs/<pack_id>/metrics` - Get metrics for a pack
- `/api/summary/<runame>` - Get summary data for a run

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request
