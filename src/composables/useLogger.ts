// useLogger — thin component-facing wrapper over the core logger (FRONTEND_WORKFLOW.md §5.3).
// Auto-tags lines with the calling component's name, so logs read "[DetailPane] …" for free.
import { getCurrentInstance } from 'vue';
import { logger } from '@/core/logging/logger';

export function useLogger(scope?: string) {
  return logger.scoped(scope ?? getCurrentInstance()?.type.__name ?? 'component');
}
