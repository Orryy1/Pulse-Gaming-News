// The drawn-scene registry: every period-object and silhouette scene by the style name the chooser returns
// ("Objects/fax", "Silhouettes/queue"), so the integration step can take a candidate from ./choose.ts and draw
// it with <DrawnScene style={c.style} len year={c.year} month={c.month} />. Each entry says which family it
// belongs to and the sound it suits on entry (the graphic packs' vocabulary: "pop", "glint" or "stamp").
import React from "react";
import {
  OBJECT_SCENES,
  SILHOUETTE_SCENES,
  type ObjectScene,
  type SceneArea,
  type SilhouetteScene,
} from "./choose.ts";
import type { SceneProps } from "./kit.tsx";
import { OBJECT_COMPONENTS } from "./Objects.tsx";
import { SILHOUETTE_COMPONENTS } from "./Silhouettes.tsx";

export interface SceneStyle {
  area: SceneArea;
  scene: ObjectScene | SilhouetteScene;
  component: React.FC<SceneProps>;
  sound: "pop" | "glint" | "stamp";
}

const SOUND: Partial<
  Record<ObjectScene | SilhouetteScene, SceneStyle["sound"]>
> = {
  discs: "stamp",
  calendar: "glint",
  clock: "glint",
  handshake: "glint",
  cheer: "pop",
};

export const SCENE_STYLES: Record<string, SceneStyle> = Object.fromEntries([
  ...OBJECT_SCENES.map((scene) => [
    `Objects/${scene}`,
    {
      area: "objects",
      scene,
      component: OBJECT_COMPONENTS[scene],
      sound: SOUND[scene] ?? "pop",
    },
  ]),
  ...SILHOUETTE_SCENES.map((scene) => [
    `Silhouettes/${scene}`,
    {
      area: "silhouettes",
      scene,
      component: SILHOUETTE_COMPONENTS[scene],
      sound: SOUND[scene] ?? "pop",
    },
  ]),
]);

/** Draws a scene by its style name; nothing for a name the registry does not know. */
export const DrawnScene: React.FC<SceneProps & { style: string }> = ({
  style,
  ...props
}) => {
  const s = SCENE_STYLES[style];
  return s ? React.createElement(s.component, props) : null;
};

export {
  objectsFor,
  silhouetteFor,
  objectsDecision,
  silhouetteDecision,
} from "./choose.ts";
export type { SceneCandidate, SceneMoment, SceneChapter } from "./choose.ts";
export type { SceneProps } from "./kit.tsx";
