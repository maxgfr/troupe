"use client";

import { useRef } from "react";

import { api } from "~/trpc/react";

// Choosing a line's emotion: the chip shows chosen at once, the choices are
// saved one at a time in the order made (a scope: a later click never lands
// before an earlier one), a failed save puts the saved emotion back, and the
// script is read back once, after the last choice in flight has landed, so a
// refetch never undoes a choice still on its way.
export function useLineEmotion(projectId: string) {
  const utils = api.useUtils();
  const inFlight = useRef(0);
  return api.script.setLineEmotion.useMutation({
    scope: { id: `line-emotion-${projectId}` },
    onMutate: async ({ scriptId, lineIndex, emotion }) => {
      inFlight.current += 1;
      await utils.script.history.cancel({ projectId });
      const previous = utils.script.history.getData({ projectId });
      utils.script.history.setData({ projectId }, (versions) =>
        versions?.map((v) =>
          v.id === scriptId ? { ...v, lines: v.lines.map((l) => (l.index === lineIndex ? { ...l, emotion } : l)) } : v,
        ),
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context) utils.script.history.setData({ projectId }, context.previous);
    },
    onSettled: () => {
      inFlight.current -= 1;
      if (inFlight.current === 0) void utils.script.history.invalidate({ projectId });
    },
  });
}
