import React from "react";
import { Composition, Still } from "remotion";
import { Short } from "./Short.tsx";
import { FPS, WIDTH, HEIGHT, SAMPLE_PROPS, type ShortProps } from "./props.ts";
import { Avatar, Banner, Thumb, SAMPLE_THUMB } from "./Brand.tsx";
import { ShortSearchThumb, SHORT_THUMB_H, SHORT_THUMB_W } from "./ShortSearchThumb.tsx";
import { EraFrame, ERA_FRAME_H, ERA_FRAME_W, SAMPLE_ERA_FRAME } from "./EraFrame.tsx";
import { Long, SAMPLE_LONG_PROPS, type LongProps } from "./Long.tsx";
import { LONG_FPS, LONG_WIDTH, LONG_HEIGHT } from "./longplan.ts";
import { Engage, SAMPLE_ENGAGE } from "./Engage.tsx";
import { Cutdown, SAMPLE_CUTDOWN, type CutdownProps } from "./Cutdown.tsx";
import {
  GameplayShort,
  SAMPLE_GAMEPLAY_SHORT,
  type GameplayShortProps,
} from "./GameplayShort.tsx";
import { ChannelTrailer, TRAILER_FPS, TRAILER_H, TRAILER_SECONDS, TRAILER_W } from "./ChannelTrailer.tsx";
import { Lab, SAMPLE_LAB, type LabProps } from "./Lab.tsx";
import { DepthProof, SAMPLE_DEPTH_PROOF, type DepthProofProps } from "./DepthProof.tsx";
import { GtaKitPreview, SAMPLE_KIT, type GtaKitPreviewProps } from "./components/GtaKitPreview.tsx";
import { IdeasProof, SAMPLE_IDEAS_PROOF, ideasProofScenes, type IdeasProofProps } from "./IdeasProof.tsx";
import { MascotSheet, SHEET_H, SHEET_W } from "./MascotSheet.tsx";
import {
  StreamWeekly,
  SAMPLE_STREAM_WEEKLY,
  STREAM_WEEKLY_FPS,
  type StreamWeeklyProps,
} from "./StreamWeekly.tsx";
import {
  ConceptAvatar,
  ConceptBanner,
  SeriesBanner,
  SERIES_BANNER,
  DailyBanner,
  DAILY_BANNER,
  BroadcastCover,
} from "./BrandConcepts.tsx";
import {
  TextureBackground,
  type BackgroundKind,
} from "./components/Backgrounds.tsx";
import {
  GfxPreview,
  SAMPLE_GFX,
  type GfxPreviewProps,
} from "./components/packs/Preview.tsx";
import {
  SketchPreview,
  SAMPLE_SKETCH,
  type SketchPreviewProps,
} from "./SketchPreview.tsx";
import {
  PhotoPreview,
  SAMPLE_PHOTO,
  type PhotoPreviewProps,
} from "./PhotoPreview.tsx";
import {
  ReconPreview,
  SAMPLE_RECON,
  type ReconPreviewProps,
} from "./ReconPreview.tsx";
import {
  WordPreview,
  SAMPLE_WORD,
  type WordPreviewProps,
} from "./components/wordmoment/Preview.tsx";
import {
  LocalVideoPreview,
  SAMPLE_LOCALVIDEO,
  type LocalVideoPreviewProps,
} from "./components/localvideo/Preview.tsx";

export const RemotionRoot: React.FC = () => (
  <>
    {/* Pip the mascot: every reaction on one sheet (src/render/MascotSheet.tsx). */}
    <Still id="PulseMascotSheet" component={MascotSheet} width={SHEET_W} height={SHEET_H} defaultProps={{ frame: 30 }} />
    <Composition
      id="PulseLab"
      component={Lab}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      durationInFrames={Math.ceil(SAMPLE_LAB.durationSeconds * FPS)}
      defaultProps={SAMPLE_LAB}
      calculateMetadata={({ props }: { props: LabProps }) => ({
        durationInFrames: Math.ceil(props.durationSeconds * FPS),
      })}
    />
    <Composition
      id="PulseShort"
      component={Short}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      durationInFrames={Math.ceil(SAMPLE_PROPS.durationSeconds * FPS)}
      defaultProps={SAMPLE_PROPS}
      calculateMetadata={({ props }: { props: ShortProps }) => ({
        durationInFrames: Math.max(
          FPS * 5,
          Math.ceil(props.durationSeconds * FPS),
        ),
      })}
    />
    <Composition
      id="PulseLong"
      component={Long}
      fps={LONG_FPS}
      width={LONG_WIDTH}
      height={LONG_HEIGHT}
      durationInFrames={Math.ceil(SAMPLE_LONG_PROPS.durationSeconds * LONG_FPS)}
      defaultProps={SAMPLE_LONG_PROPS}
      calculateMetadata={({ props }: { props: LongProps }) => ({
        durationInFrames: Math.max(
          LONG_FPS * 10,
          Math.ceil(props.durationSeconds * LONG_FPS),
        ),
      })}
    />
    <Composition
      id="PulseCutdown"
      component={Cutdown}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      durationInFrames={Math.ceil(SAMPLE_CUTDOWN.durationSeconds * FPS)}
      defaultProps={SAMPLE_CUTDOWN}
      calculateMetadata={({ props }: { props: CutdownProps }) => ({
        durationInFrames: Math.max(
          FPS * 5,
          Math.ceil(props.durationSeconds * FPS),
        ),
      })}
    />
    <Composition
      id="PulseGameplayShort"
      component={GameplayShort}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      durationInFrames={Math.ceil(SAMPLE_GAMEPLAY_SHORT.durationSeconds * FPS)}
      defaultProps={SAMPLE_GAMEPLAY_SHORT}
      calculateMetadata={({ props }: { props: GameplayShortProps }) => ({
        durationInFrames: Math.max(
          FPS * 5,
          Math.ceil(props.durationSeconds * FPS),
        ),
      })}
    />
    {/* One graphic style on its own, for previews (src/render/components/packs). */}
    <Composition
      id="PulseGfx"
      component={GfxPreview}
      fps={LONG_FPS}
      width={LONG_WIDTH}
      height={LONG_HEIGHT}
      durationInFrames={Math.ceil(SAMPLE_GFX.durationSeconds * LONG_FPS)}
      defaultProps={SAMPLE_GFX}
      calculateMetadata={({ props }: { props: GfxPreviewProps }) => ({
        durationInFrames: Math.ceil(props.durationSeconds * LONG_FPS),
      })}
    />
    {/* One word-moment look on its own, for previews (src/render/components/wordmoment/Preview.tsx). */}
    <Composition
      id="PulseWord"
      component={WordPreview}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      durationInFrames={Math.ceil(SAMPLE_WORD.durationSeconds * FPS)}
      defaultProps={SAMPLE_WORD}
      calculateMetadata={({ props }: { props: WordPreviewProps }) => ({
        durationInFrames: Math.max(30, Math.ceil(props.durationSeconds * FPS)),
      })}
    />
    {/* One photo treatment or screenshot display on its own, for previews (src/render/PhotoPreview.tsx). */}
    <Composition
      id="PulsePhoto"
      component={PhotoPreview}
      fps={LONG_FPS}
      width={LONG_WIDTH}
      height={LONG_HEIGHT}
      durationInFrames={Math.ceil(SAMPLE_PHOTO.durationSeconds * LONG_FPS)}
      defaultProps={SAMPLE_PHOTO}
      calculateMetadata={({ props }: { props: PhotoPreviewProps }) => ({
        durationInFrames: Math.max(
          30,
          Math.ceil(props.durationSeconds * LONG_FPS),
        ),
      })}
    />
    {/* One concept-sketch treatment on its own, for previews (src/render/SketchPreview.tsx). */}
    <Composition
      id="PulseSketch"
      component={SketchPreview}
      fps={LONG_FPS}
      width={LONG_WIDTH}
      height={LONG_HEIGHT}
      durationInFrames={Math.ceil(SAMPLE_SKETCH.durationSeconds * LONG_FPS)}
      defaultProps={SAMPLE_SKETCH}
      calculateMetadata={({ props }: { props: SketchPreviewProps }) => ({
        durationInFrames: Math.max(
          30,
          Math.ceil(props.durationSeconds * LONG_FPS),
        ),
      })}
    />
    {/* One in-game reconstruction shot on its own, for previews (src/render/ReconPreview.tsx). */}
    <Composition
      id="PulseRecon"
      component={ReconPreview}
      fps={LONG_FPS}
      width={LONG_WIDTH}
      height={LONG_HEIGHT}
      durationInFrames={Math.ceil(SAMPLE_RECON.durationSeconds * LONG_FPS)}
      defaultProps={SAMPLE_RECON}
      calculateMetadata={({ props }: { props: ReconPreviewProps }) => ({
        durationInFrames: Math.max(
          30,
          Math.ceil(props.durationSeconds * LONG_FPS),
        ),
      })}
    />
    {/* The explainer backgrounds on their own, for previews (src/render/components/Backgrounds.tsx). */}
    <Composition
      id="PulseBackground"
      component={
        TextureBackground as React.FC<{
          kind: BackgroundKind;
          variant?: number;
        }>
      }
      fps={LONG_FPS}
      width={LONG_WIDTH}
      height={LONG_HEIGHT}
      durationInFrames={LONG_FPS * 6}
      defaultProps={{ kind: "crumpled" as BackgroundKind, variant: 0 }}
    />
    {/* Channel brand stills: rendered by `npm run brand` into factory/brand/. */}
    <Still id="PulseBanner" component={Banner} width={2560} height={1440} />
    <Still id="PulseAvatar" component={Avatar} width={800} height={800} />
    <Still
      id="PulseShortThumb"
      component={ShortSearchThumb as never}
      width={SHORT_THUMB_W}
      height={SHORT_THUMB_H}
      defaultProps={{ imageSrc: "", words: "HOOK WORDS" } as never}
    />
    {/* A game on the hardware of its day, for an every-game Short (src/editorial/everygame.ts). */}
    <Still
      id="PulseEraFrame"
      component={EraFrame as never}
      width={ERA_FRAME_W}
      height={ERA_FRAME_H}
      defaultProps={SAMPLE_ERA_FRAME as never}
    />
    {/* A timeline, not a Still: the motif thumbnail freezes a motif card part-way through its animation. */}
    <Composition
      id="PulseThumb"
      component={Thumb}
      width={1280}
      height={720}
      fps={30}
      durationInFrames={150}
      defaultProps={SAMPLE_THUMB}
    />
    {/* Redesign directions for the owner to choose from (src/render/BrandConcepts.tsx). */}
    <Still
      id="FacebookCover"
      component={BroadcastCover}
      width={1640}
      height={624}
      defaultProps={{ width: 1640, height: 624, contentWidth: 1180 }}
    />
    <Still
      id="XHeader"
      component={BroadcastCover}
      width={1500}
      height={500}
      defaultProps={{
        width: 1500,
        height: 500,
        contentWidth: 1000,
        offsetX: 140,
      }}
    />
    <Still
      id="ConceptAvatar"
      component={ConceptAvatar}
      width={800}
      height={800}
      defaultProps={{ concept: "signal" as const }}
    />
    <Still
      id="DailyBanner"
      component={DailyBanner}
      width={2560}
      height={1440}
      defaultProps={DAILY_BANNER}
    />
    <Composition
      id="ChannelTrailer"
      component={ChannelTrailer}
      durationInFrames={Math.round(TRAILER_SECONDS * TRAILER_FPS)}
      fps={TRAILER_FPS}
      width={TRAILER_W}
      height={TRAILER_H}
    />
    <Still
      id="SeriesBanner"
      component={SeriesBanner}
      width={2560}
      height={1440}
      defaultProps={SERIES_BANNER}
    />
    <Still
      id="ConceptBanner"
      component={ConceptBanner}
      width={2560}
      height={1440}
      defaultProps={{ concept: "signal" as const }}
    />
    <Still
      id="PulseEngage"
      component={Engage}
      width={1080}
      height={1350}
      defaultProps={SAMPLE_ENGAGE}
    />
    {/* The weekly compilation of the owner's streams (src/streamweekly). */}
    <Composition
      id="PulseStreamWeekly"
      component={StreamWeekly}
      fps={STREAM_WEEKLY_FPS}
      width={LONG_WIDTH}
      height={LONG_HEIGHT}
      durationInFrames={Math.ceil(SAMPLE_STREAM_WEEKLY.durationSeconds * STREAM_WEEKLY_FPS)}
      defaultProps={SAMPLE_STREAM_WEEKLY}
      calculateMetadata={({ props }: { props: StreamWeeklyProps }) => ({
        durationInFrames: Math.max(
          STREAM_WEEKLY_FPS * 5,
          Math.ceil(props.durationSeconds * STREAM_WEEKLY_FPS),
        ),
      })}
    />
    {/* One AI motion clip shot on its own, for previews (src/render/components/localvideo/Preview.tsx). */}
    <Composition
      id="PulseLocalVideo"
      component={LocalVideoPreview}
      fps={LONG_FPS}
      width={LONG_WIDTH}
      height={LONG_HEIGHT}
      durationInFrames={Math.ceil(SAMPLE_LOCALVIDEO.durationSeconds * LONG_FPS)}
      defaultProps={SAMPLE_LOCALVIDEO}
      calculateMetadata={({ props }: { props: LocalVideoPreviewProps }) => ({
        durationInFrames: Math.max(
          30,
          Math.ceil(props.durationSeconds * LONG_FPS),
        ),
      })}
    />
    {/* PARALLAX_DEEP proof reel: real stills, the three-layer drift or the depth camera (src/render/DepthProof.tsx). */}
    <Composition
      id="PulseDepthProof"
      component={DepthProof}
      fps={LONG_FPS}
      width={SAMPLE_DEPTH_PROOF.width}
      height={SAMPLE_DEPTH_PROOF.height}
      durationInFrames={LONG_FPS * 4}
      defaultProps={SAMPLE_DEPTH_PROOF}
      calculateMetadata={({ props }: { props: DepthProofProps }) => ({
        width: props.width,
        height: props.height,
        durationInFrames: Math.max(1, props.items.length) * Math.round(props.seconds * LONG_FPS),
      })}
    />
    {/* CHAPTER_WALL, DEPTH_TYPE and COMPARE_WIPE proof reel (src/render/IdeasProof.tsx). */}
    <Composition
      id="PulseIdeasProof"
      component={IdeasProof}
      fps={LONG_FPS}
      width={LONG_WIDTH}
      height={LONG_HEIGHT}
      durationInFrames={LONG_FPS * 4}
      defaultProps={SAMPLE_IDEAS_PROOF}
      calculateMetadata={({ props }: { props: IdeasProofProps }) => ({
        durationInFrames: Math.max(1, ideasProofScenes(props)) * Math.round(props.seconds * LONG_FPS),
      })}
    />
    {/* GTA_KIT proof reel: the place card, cash readout and head-to-head, tall or wide (src/render/gtakit.ts). */}
    <Composition
      id="PulseGtaKit"
      component={GtaKitPreview}
      fps={LONG_FPS}
      width={LONG_WIDTH}
      height={LONG_HEIGHT}
      durationInFrames={360}
      defaultProps={{ tall: false, moments: SAMPLE_KIT } as GtaKitPreviewProps}
      calculateMetadata={({ props }: { props: GtaKitPreviewProps }) => ({
        width: props.tall ? WIDTH : LONG_WIDTH,
        height: props.tall ? HEIGHT : LONG_HEIGHT,
        durationInFrames: Math.max(30, ...props.moments.map((m) => m.from + m.len)),
      })}
    />
  </>
);
