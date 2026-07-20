import { useEffect, useRef } from 'react';
import { useProjectStore } from '@/features/project/store';
import { useSkillStore } from '@/features/skill/store';

/**
 * When the active project changes, incrementally apply bound tag-group skills
 * to agent skill directories (install only — never removes other skills).
 *
 * Mount once near the app shell so it runs regardless of Skills panel visibility.
 */
export function useApplyProjectSkills() {
  const activeProjectId = useProjectStore(s => s.activeProjectId);
  const applyProjectSkillsOnSelect = useSkillStore(s => s.applyProjectSkillsOnSelect);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    // Debounce rapid project switches
    timerRef.current = setTimeout(() => {
      void applyProjectSkillsOnSelect(activeProjectId);
    }, 300);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [activeProjectId, applyProjectSkillsOnSelect]);
}
