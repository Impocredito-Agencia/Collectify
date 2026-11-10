import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { channelRemindersApi } from '@/features/channelReminders/channelRemindersApi';

import type { ChannelSchedule } from '@/features/channelReminders/channelRemindersApi';

const SCHEDULES_KEY = ['channelReminderSchedules'];
const RECIPIENTS_KEY = ['channelReminderRecipients'];

export function useChannelSchedules() {
  return useQuery({
    queryKey: SCHEDULES_KEY,
    queryFn: channelRemindersApi.getSchedules,
  });
}

function useReplaceSchedule() {
  const queryClient = useQueryClient();
  return (updated: ChannelSchedule) =>
    queryClient.setQueryData<ChannelSchedule[]>(SCHEDULES_KEY, (current) =>
      current?.map((schedule) =>
        schedule.id === updated.id ? updated : schedule,
      ),
    );
}

export function useRescheduleChannel() {
  const replace = useReplaceSchedule();
  return useMutation({
    mutationFn: channelRemindersApi.reschedule,
    onSuccess: replace,
  });
}

export function useSetChannelPaused() {
  const replace = useReplaceSchedule();
  return useMutation({
    mutationFn: channelRemindersApi.setPaused,
    onSuccess: replace,
  });
}

export function useChannelRecipients() {
  return useQuery({
    queryKey: RECIPIENTS_KEY,
    queryFn: channelRemindersApi.getRecipients,
  });
}

// Both refresh the recipients list and every cached client profile, since
// the same two flags show in both places.
export function useUpdateChannelRecipients() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: channelRemindersApi.updateRecipients,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: RECIPIENTS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}

export function useUpdateChannelRecipient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: channelRemindersApi.updateRecipient,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: RECIPIENTS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}
