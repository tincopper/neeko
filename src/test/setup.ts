import '@testing-library/jest-dom';

// Mock asset imports (Vite transforms these to URLs in production)
vi.mock('*.png', () => ({ default: 'mock-png-url' }));
vi.mock('*.svg', () => ({ default: 'mock-svg-url' }));
