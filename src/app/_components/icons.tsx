// The studio's icons: one 20 px grid, a 1.6 stroke with round caps and
// joins, drawn in currentColor so a state is a colour, never another file.
// Decorative by default (aria-hidden): the text beside an icon names it, or
// the control carries an aria-label.

type IconProps = { className?: string };

function Icon({
  className = "size-5",
  children,
  filled = false,
}: IconProps & { children: React.ReactNode; filled?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      {children}
    </svg>
  );
}

// Projects: four posters on a wall.
export const ProjectsIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="6" height="7.5" rx="1.5" />
    <rect x="11" y="3" width="6" height="5" rx="1.5" />
    <rect x="3" y="12.5" width="6" height="4.5" rx="1.5" />
    <rect x="11" y="10" width="6" height="7" rx="1.5" />
  </Icon>
);

// Library: saved pieces, stacked.
export const LibraryIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="7" width="13" height="10" rx="1.5" />
    <path d="M5.5 4.5h9M7.5 2.5h5" />
  </Icon>
);

// Actors: a head and shoulders.
export const ActorsIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="7" r="3.25" />
    <path d="M3.5 17c.9-3.2 3.4-5 6.5-5s5.6 1.8 6.5 5" />
  </Icon>
);

// Compare: two renders side by side.
export const CompareIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="4" width="6.5" height="12" rx="1.5" />
    <rect x="11" y="4" width="6.5" height="12" rx="1.5" />
  </Icon>
);

// Settings: three sliders.
export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 5h14M3 10h14M3 15h14" opacity="0.55" />
    <circle cx="7" cy="5" r="1.9" fill="currentColor" />
    <circle cx="13" cy="10" r="1.9" fill="currentColor" />
    <circle cx="9" cy="15" r="1.9" fill="currentColor" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 4v12M4 10h12" />
  </Icon>
);

// Optically centred: the triangle sits a little right of the box's middle.
export const PlayIcon = (p: IconProps) => (
  <Icon {...p} filled>
    <path d="M7 4.8v10.4c0 .6.7 1 1.2.6l7.6-5.2a.7.7 0 0 0 0-1.2L8.2 4.2c-.5-.4-1.2 0-1.2.6z" stroke="none" />
  </Icon>
);

export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 3.5v9M6 9l4 4 4-4M4 16.5h12" />
  </Icon>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 10h12M11.5 5.5 16 10l-4.5 4.5" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 10.5 8 14l7.5-8" />
  </Icon>
);

// A sort's direction: points down, turned for ascending.
export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 8 5 5 5-5" />
  </Icon>
);

// A disclosure's mark: turns a quarter when it opens.
export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m8 5 5 5-5 5" />
  </Icon>
);

export const ArrowLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M16 10H4M8.5 5.5 4 10l4.5 4.5" />
  </Icon>
);

// Leaves the studio (another site, a document on GitHub).
export const ExternalIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 13 14 6M8.5 5.5H14.5V11.5" />
  </Icon>
);

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8.5" cy="8.5" r="5.5" />
    <path d="m13 13 4 4" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 5l10 10M15 5 5 15" />
  </Icon>
);

export const ChatIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 13.5a2.5 2.5 0 0 1-2.5-2.5V5.5A2.5 2.5 0 0 1 6 3h8a2.5 2.5 0 0 1 2.5 2.5V11a2.5 2.5 0 0 1-2.5 2.5H9.5L6 16.5z" />
  </Icon>
);

export const FilmIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3.5" width="14" height="13" rx="2" />
    <path d="M3 7h14M3 13h14M7 3.5V7M13 3.5V7M7 13v3.5M13 13v3.5" />
  </Icon>
);
