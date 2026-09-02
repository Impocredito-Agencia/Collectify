import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { whatsappApi } from '@/features/whatsapp/whatsappApi';

import type { ReminderFamily } from '@/features/whatsapp/whatsappApi';

// Phase 33 — parametrized by FAMILY, not MessageType: cron is now shared
// across several templates per family (see whatsappApi.ts's doc comment),
// not one job per template. Replaces the old per-MessageType hooks.
export function useCronStatus(family: ReminderFamily) {
  return useQuery({
    queryKey: ['whatsapp', 'cronStatus', family],
    queryFn: () => whatsappApi.getCronStatus(family),
  });
}

export function usePauseCron(family: ReminderFamily) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => whatsappApi.pauseCron(family),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['whatsapp', 'cronStatus', family],
      }),
  });
}

export function useResumeCron(family: ReminderFamily) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => whatsappApi.resumeCron(family),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['whatsapp', 'cronStatus', family],
      }),
  });
}

export function useUpdateCronSchedule(family: ReminderFamily) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cronExpression: string) =>
      whatsappApi.updateCronSchedule(family, cronExpression),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['whatsapp', 'cronStatus', family],
        }),
        queryClient.invalidateQueries({ queryKey: ['messageTemplates'] }),
      ]),
  });
}

// Invalidates messageLogs (and, via clientId, the client's own history)
// since a successful manual send creates a new MessageLog row.
export function useSendReminder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: whatsappApi.sendReminder,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['messageLogs'] }),
  });
}

export function useSendUpcomingDueReminder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: whatsappApi.sendUpcomingDueReminder,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['messageLogs'] }),
  });
}
