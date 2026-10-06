"use client";

import { Drawer } from "@heroui/react/drawer";
import { useEffect, useRef, useState, type ComponentProps } from "react";

import { ChatIcon } from "~/app/_components/icons";
import { buttonClass } from "~/app/_components/ui";
import { ChatPanel } from "./chat-panel";

// The chat below the large breakpoint: a bottom drawer (HeroUI, on React
// Aria) that is a modal dialog. It traps focus, closes with Escape, a tap
// outside, a swipe down or Close, and gives focus back to the Chat button.
export function ChatDrawer(props: Omit<ComponentProps<typeof ChatPanel>, "heading" | "closeButton" | "onLaunched">) {
  const [open, setOpen] = useState(false);
  return (
    <Drawer isOpen={open} onOpenChange={setOpen}>
      <Drawer.Trigger className={buttonClass({ variant: "secondary", size: "sm", className: "data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-primary" })}>
        <ChatIcon className="size-4" />
        Chat
      </Drawer.Trigger>
      <Drawer.Backdrop className="bg-black/55 backdrop-blur-[2px]">
        <Drawer.Content placement="bottom">
          <Drawer.Dialog className="flex h-[88dvh] flex-col rounded-t-2xl bg-raised pt-2 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] pb-[max(1rem,env(safe-area-inset-bottom))] text-fg shadow-overlay">
            <Drawer.Handle />
            <MarkModal />
            <ChatPanel
              {...props}
              heading={(title) => <Drawer.Heading className="text-base font-semibold">{title}</Drawer.Heading>}
              closeButton={
                <button type="button" slot="close" onClick={() => setOpen(false)} className={buttonClass({ variant: "quiet", className: "-mr-2" })}>
                  Close
                </button>
              }
              onLaunched={() => setOpen(false)}
            />
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}

// React Aria hides the rest of the page from assistive technology while the
// drawer is open but leaves aria-modal off its dialog (and drops the prop).
// Said here as well, for screen readers that rely on it.
function MarkModal() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.closest('[role="dialog"]')?.setAttribute("aria-modal", "true");
  }, []);
  return <span ref={ref} hidden />;
}
