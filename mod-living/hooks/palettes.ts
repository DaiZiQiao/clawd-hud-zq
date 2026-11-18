// The app's colours for each scene, built by makeColors from a few anchors.
// Ink, aurora, coral and lava are night scenes; the meadow is a summer day.
export const PALETTES = {
  ink: {
    label: 'Living: Ink', only: 'dark',
    roles: { accent: '#8a6cf0', danger: '#e0525a', success: '#4fb07a', warning: '#d9a13a', pro: '#c06ad8' },
    dark: { gray: { anchors: { 'surface-0': '#0b0a12', 'surface-1': '#110f1a', 'surface-2': '#161422', 'surface-3': '#1b1828', 'text-primary': '#ecebf5', 'text-secondary': '#c3c1d4', 'text-muted': '#9d9ab2' } } },
  },
  aurora: {
    label: 'Living: Aurora', only: 'dark',
    roles: { accent: '#38b6c9', danger: '#e0565a', success: '#4cb36a', warning: '#d9a43a', pro: '#9a6cf0' },
    dark: { gray: { anchors: { 'surface-0': '#050b12', 'surface-1': '#08111a', 'surface-2': '#0c1721', 'surface-3': '#101c28', 'text-primary': '#e6f2f0', 'text-secondary': '#b5ccc9', 'text-muted': '#8fa9a6' } } },
  },
  coral: {
    label: 'Living: Coral', only: 'dark',
    roles: { accent: '#2fb3b0', danger: '#e0565a', success: '#4fae6a', warning: '#e0a03a', pro: '#9a7af0' },
    dark: { gray: { anchors: { 'surface-0': '#04090d', 'surface-1': '#071017', 'surface-2': '#0a151d', 'surface-3': '#0e1a23', 'text-primary': '#e4f0f0', 'text-secondary': '#b3c9ca', 'text-muted': '#8da6a8' } } },
  },
  lava: {
    label: 'Living: Lava', only: 'dark',
    roles: { accent: '#e86a8a', danger: '#e0453a', success: '#5fae6a', warning: '#e0a53a', pro: '#a070e0' },
    dark: { gray: { anchors: { 'surface-0': '#10060f', 'surface-1': '#170a15', 'surface-2': '#1d0e1b', 'surface-3': '#221220', 'text-primary': '#f5e6ee', 'text-secondary': '#d6bccb', 'text-muted': '#b296a6' } } },
  },
  meadow: {
    label: 'Living: Meadow', only: 'light',
    roles: { accent: '#2f7fd6', danger: '#c8443a', success: '#3f8f3a', warning: '#a8740e', pro: '#7a55c0' },
    light: { gray: { anchors: { 'surface-0': '#eaf2f7', 'surface-1': '#f2f7fa', 'surface-2': '#f9fbfd', 'text-primary': '#12242d', 'text-secondary': '#32505c', 'text-muted': '#4a6670' } } },
  },
} as const
