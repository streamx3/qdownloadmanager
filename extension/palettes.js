// SPDX-License-Identifier: MIT
// Dr Stein palettes, kept in parity with qml/Theme.qml by tests/theme.test.js.
// See LICENSE.dr-stein for the original license.
export const palettes = {
    blurple: {
        accent: "#9184d9", accent2: "#a7a1db",
        accentRamp: ["#f5f4ff", "#e7e5fe", "#d2cefd", "#b5abfc", "#968ae0", "#796cbf", "#5d5294", "#423a6a", "#2b2741"],
        neutralRamp: ["#f3f5fe", "#e4e7f5", "#cfd3e5", "#b2b6ca", "#9397ab", "#75798c", "#595d6c", "#3f424d", "#292b31"],
        dark: { bg: "#161826", surface: "#232532", text: "#e9e9ed", edge: "#3f424d", edge2: "#595d6c", edge3: "#9397ab" },
        light: { bg: "#eef0f7", surface: "#f9f9fd", text: "#1c1e2b", edge: "#cfd3e5", edge2: "#b2b6ca", edge3: "#75798c" }
    },
    // Apple's system blue and greys, for people who want the app to sit next to Finder.
    blue: {
        accent: "#0a84ff", accent2: "#64b5ff",
        accentRamp: ["#eaf4ff", "#cfe6ff", "#a8d1ff", "#7ab8ff", "#4da3ff", "#0a84ff", "#0066d6", "#004ea8", "#003a7d"],
        neutralRamp: ["#f5f5f7", "#e5e5ea", "#d1d1d6", "#c7c7cc", "#aeaeb2", "#8e8e93", "#636366", "#48484a", "#2c2c2e"],
        dark: { bg: "#1c1c1e", surface: "#2c2c2e", text: "#f2f2f7", edge: "#3a3a3c", edge2: "#48484a", edge3: "#8e8e93" },
        light: { bg: "#f2f2f7", surface: "#ffffff", text: "#1c1c1e", edge: "#d1d1d6", edge2: "#c7c7cc", edge3: "#8e8e93" }
    },
    // No hue at all: the accent is a lighter grey, status colours are the only colour left.
    grey: {
        accent: "#a8a8a8", accent2: "#c2c2c2",
        accentRamp: ["#f6f6f6", "#e8e8e8", "#d4d4d4", "#bcbcbc", "#a8a8a8", "#8a8a8a", "#6b6b6b", "#4c4c4c", "#323232"],
        neutralRamp: ["#f0f0f0", "#e0e0e0", "#c8c8c8", "#adadad", "#8f8f8f", "#727272", "#565656", "#3d3d3d", "#282828"],
        dark: { bg: "#141414", surface: "#1f1f1f", text: "#e8e8e8", edge: "#2e2e2e", edge2: "#454545", edge3: "#7d7d7d" },
        light: { bg: "#ededed", surface: "#f9f9f9", text: "#1a1a1a", edge: "#cfcfcf", edge2: "#b5b5b5", edge3: "#727272" }
    },
    teal: {
        accent: "#3fc9c4", accent2: "#7ad3cf",
        accentRamp: ["#ecfffd", "#cdfaf7", "#a6f0ec", "#6fdfda", "#3fc9c4", "#22a39f", "#167c7a", "#105857", "#0b3a3a"],
        neutralRamp: ["#eef7f8", "#dceaec", "#c3d6d9", "#a4b9bd", "#869a9f", "#687c81", "#4e5f63", "#374448", "#23303a"],
        dark: { bg: "#0c1619", surface: "#132226", text: "#dff1f2", edge: "#24383d", edge2: "#375056", edge3: "#5f8389" },
        light: { bg: "#e9f3f4", surface: "#f6fbfb", text: "#10272a", edge: "#c3d6d9", edge2: "#a4b9bd", edge3: "#687c81" }
    }
};
