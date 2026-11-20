import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { channelTemplatesApi } from '@/features/channelTemplates/channelTemplatesApi';

import type { ChannelTemplate } from '@/features/channelTemplates/channelTemplatesApi';

const QUERY_KEY = ['channelTemplates'];

export function useChannelTemplates() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: channelTemplatesApi.getAll,
  });
}

export function useUpdateChannelTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: channelTemplatesApi.update,
    onSuccess: (updated) => {
      queryClient.setQueryData<ChannelTemplate[]>(QUERY_KEY, (current) =>
        current?.map((template) =>
          template.type === updated.type && template.channel === updated.channel
            ? updated
            : template,
        ),
      );
    },
  });
}

export function useSendChannelTemplateTest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: channelTemplatesApi.sendTest,
    // A sent SMS spends a credit — refresh the balance on the Brevo card.
    onSuccess: (result) => {
      if (result.sent) {
        void queryClient.invalidateQueries({ queryKey: ['brevoStatus'] });
      }
    },
  });
}
