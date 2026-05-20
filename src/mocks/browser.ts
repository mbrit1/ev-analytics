import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

/**
 * Browser MSW worker used only when local mock mode is enabled.
 */
export const worker = setupWorker(...handlers)
