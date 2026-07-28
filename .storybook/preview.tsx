import type { Decorator, Preview } from "@storybook/nextjs-vite";
import { useEffect } from "react";

/**
 * Stamps `data-theme` on the document root so stories exercise the same
 * selector the chart's CSS actually uses. Dark mode is a *selected* set of
 * steps validated against the dark surface — not an automatic flip — so it
 * needs to be reviewable side by side with light.
 */
function ThemedStory({
  theme,
  children,
}: {
  theme: "light" | "dark";
  children: React.ReactNode;
}) {
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.body.style.background = theme === "dark" ? "#0d0d0d" : "#f9f9f7";
    document.body.style.padding = "1.5rem";
  }, [theme]);
  return <>{children}</>;
}

const withTheme: Decorator = (Story, context) => (
  <ThemedStory theme={context.globals.theme as "light" | "dark"}>
    <Story />
  </ThemedStory>
);

const preview: Preview = {
  decorators: [withTheme],

  initialGlobals: { theme: "light" },

  globalTypes: {
    theme: {
      description: "Colour scheme",
      toolbar: {
        icon: "circlehollow",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },

  parameters: {
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },

    // Accessibility is a stated non-negotiable for this project, so a violation
    // is a failing test rather than a note to look at later.
    a11y: { test: "error" },
  },
};

export default preview;
