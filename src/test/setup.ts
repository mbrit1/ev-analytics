/**
 * Shared Vitest browser-like test setup.
 *
 * fake-indexeddb gives Dexie tests a durable IndexedDB API, while jest-dom adds
 * DOM matchers used by React Testing Library assertions.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom';
