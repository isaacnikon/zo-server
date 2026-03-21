#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


SCREENSHOT_DIR = Path("/home/nikon/Pictures/Screenshots")
OUTPUT_ROOT = Path("/tmp/zo_teleporter_labels")
GAME_CROP_DIR = OUTPUT_ROOT / "game_crops"
LABEL_CROP_DIR = OUTPUT_ROOT / "label_crops"
LABEL_CONTEXT_DIR = OUTPUT_ROOT / "label_context_crops"
TITLE_CROP_DIR = OUTPUT_ROOT / "title_crops"
TITLE_TEXT_CROP_DIR = OUTPUT_ROOT / "title_text_crops"
INDEX_PATH = OUTPUT_ROOT / "label-index.json"

# Tuned against the current screenshot layout where the game window is anchored
# at the top-left of the desktop capture.
GAME_CROP_X = 0
GAME_CROP_Y = 0
GAME_CROP_W = 760
GAME_CROP_H = 505

# The map title sits inside the minimap banner, just to the right of the W icon.
TITLE_CROP_X = 78
TITLE_CROP_Y = 46
TITLE_CROP_W = 220
TITLE_CROP_H = 28

# Within the title crop, isolate the actual map-name text and exclude the W icon
# and trailing banner ornaments so title matching is text-driven.
TITLE_TEXT_OFFSET_X = 34
TITLE_TEXT_OFFSET_Y = 8
TITLE_TEXT_W = 126
TITLE_TEXT_H = 22


@dataclass
class LabelCandidate:
    x: int
    y: int
    w: int
    h: int
    red_pixels: int
    fill_brightness: float


def ensure_dirs() -> None:
    GAME_CROP_DIR.mkdir(parents=True, exist_ok=True)
    LABEL_CROP_DIR.mkdir(parents=True, exist_ok=True)
    LABEL_CONTEXT_DIR.mkdir(parents=True, exist_ok=True)
    TITLE_CROP_DIR.mkdir(parents=True, exist_ok=True)
    TITLE_TEXT_CROP_DIR.mkdir(parents=True, exist_ok=True)


def crop_game_window(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    x0 = max(0, min(GAME_CROP_X, width))
    y0 = max(0, min(GAME_CROP_Y, height))
    x1 = max(x0, min(x0 + GAME_CROP_W, width))
    y1 = max(y0, min(y0 + GAME_CROP_H, height))
    return image[y0:y1, x0:x1].copy()


def crop_title_strip(image_bgr: np.ndarray) -> np.ndarray:
    height, width = image_bgr.shape[:2]
    x0 = max(0, min(TITLE_CROP_X, width))
    y0 = max(0, min(TITLE_CROP_Y, height))
    x1 = max(x0, min(x0 + TITLE_CROP_W, width))
    y1 = max(y0, min(y0 + TITLE_CROP_H, height))
    return image_bgr[y0:y1, x0:x1].copy()


def crop_title_text(title_crop_bgr: np.ndarray) -> np.ndarray:
    height, width = title_crop_bgr.shape[:2]
    x0 = max(0, min(TITLE_TEXT_OFFSET_X, width))
    y0 = max(0, min(TITLE_TEXT_OFFSET_Y, height))
    x1 = max(x0, min(x0 + TITLE_TEXT_W, width))
    y1 = max(y0, min(y0 + TITLE_TEXT_H, height))
    return title_crop_bgr[y0:y1, x0:x1].copy()


def compute_title_identifier(title_text_crop_bgr: np.ndarray) -> str:
    gray = cv2.cvtColor(title_text_crop_bgr, cv2.COLOR_BGR2GRAY)
    # Normalize the title glyphs into a binary mask so the identifier is driven
    # by the title text rather than subtle color/background variation.
    binary = np.where(gray > 110, 255, 0).astype(np.uint8)
    if binary.shape[1] > 12:
        binary = binary[:, 6:-6]
    digest = hashlib.sha1(binary.tobytes()).hexdigest()
    return f"title-{digest[:12]}"


def build_red_mask(image_bgr: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    lower_red_1 = np.array([0, 70, 70], dtype=np.uint8)
    upper_red_1 = np.array([12, 255, 255], dtype=np.uint8)
    lower_red_2 = np.array([165, 70, 70], dtype=np.uint8)
    upper_red_2 = np.array([179, 255, 255], dtype=np.uint8)
    mask = cv2.inRange(hsv, lower_red_1, upper_red_1) | cv2.inRange(hsv, lower_red_2, upper_red_2)
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    mask = cv2.dilate(mask, kernel, iterations=1)
    return mask


def candidate_fill_brightness(image_bgr: np.ndarray, rect: tuple[int, int, int, int]) -> float:
    x, y, w, h = rect
    inner_x0 = x + max(2, w // 8)
    inner_y0 = y + max(2, h // 6)
    inner_x1 = x + w - max(2, w // 8)
    inner_y1 = y + h - max(2, h // 6)
    if inner_x1 <= inner_x0 or inner_y1 <= inner_y0:
        return 0.0
    inner = image_bgr[inner_y0:inner_y1, inner_x0:inner_x1]
    gray = cv2.cvtColor(inner, cv2.COLOR_BGR2GRAY)
    return float(gray.mean())


def is_label_viewport_rect(x: int, y: int, w: int, h: int) -> bool:
    # Restrict fallback detections to the actual map viewport to avoid the top
    # banner and right-side panel chrome.
    return 70 <= x <= 620 and 70 <= y <= 470 and x + w <= 625


def detect_label_candidates(image_bgr: np.ndarray) -> list[LabelCandidate]:
    red_mask = build_red_mask(image_bgr)
    contours, _hierarchy = cv2.findContours(red_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates: list[LabelCandidate] = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        area = w * h
        if area < 700 or area > 15000:
            continue
        if w < 45 or w > 260 or h < 12 or h > 48:
            continue
        if w / max(h, 1) < 1.6:
            continue

        contour_mask = np.zeros(red_mask.shape, dtype=np.uint8)
        cv2.drawContours(contour_mask, [contour], -1, 255, thickness=cv2.FILLED)
        red_pixels = int(cv2.countNonZero(contour_mask[y:y + h, x:x + w]))
        if red_pixels < 120:
            continue

        fill_brightness = candidate_fill_brightness(image_bgr, (x, y, w, h))
        if fill_brightness < 90:
            continue

        candidates.append(
            LabelCandidate(
                x=x,
                y=y,
                w=w,
                h=h,
                red_pixels=red_pixels,
                fill_brightness=fill_brightness,
            )
        )

    # Fallback: some labels break into two separate horizontal red bars rather
    # than one closed contour. Pair those bars into a single candidate bbox.
    thin_bars: list[tuple[int, int, int, int]] = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        if h > 10 or w < 60 or w > 220:
            continue
        if not is_label_viewport_rect(x, y, w, h):
            continue
        if w / max(h, 1) < 6.0:
            continue
        thin_bars.append((x, y, w, h))

    thin_bars.sort(key=lambda item: (item[0], item[1], item[2], item[3]))
    for index, (x0, y0, w0, h0) in enumerate(thin_bars):
        for x1, y1, w1, h1 in thin_bars[index + 1:]:
            if abs(x0 - x1) > 6:
                continue
            if abs(w0 - w1) > 12:
                continue
            gap = y1 - (y0 + h0)
            if gap < 8 or gap > 24:
                continue
            x = min(x0, x1)
            y = y0
            w = max(x0 + w0, x1 + w1) - x
            h = (y1 + h1) - y
            if not is_label_viewport_rect(x, y, w, h):
                continue
            fill_brightness = candidate_fill_brightness(image_bgr, (x, y, w, h))
            if fill_brightness < 90:
                continue
            red_pixels = int(cv2.countNonZero(red_mask[y:y + h, x:x + w]))
            if red_pixels < 80:
                continue
            candidates.append(
                LabelCandidate(
                    x=x,
                    y=y,
                    w=w,
                    h=h,
                    red_pixels=red_pixels,
                    fill_brightness=fill_brightness,
                )
            )
            break

    # Deduplicate overlapping contours by keeping the larger/better-lit rectangle.
    candidates.sort(key=lambda item: (item.x, item.y, -item.w * item.h))
    deduped: list[LabelCandidate] = []
    for candidate in candidates:
        matched = False
        for existing in deduped:
            overlap_x = max(0, min(candidate.x + candidate.w, existing.x + existing.w) - max(candidate.x, existing.x))
            overlap_y = max(0, min(candidate.y + candidate.h, existing.y + existing.h) - max(candidate.y, existing.y))
            overlap_area = overlap_x * overlap_y
            min_area = min(candidate.w * candidate.h, existing.w * existing.h)
            if min_area > 0 and overlap_area / min_area > 0.6:
                matched = True
                if candidate.w * candidate.h > existing.w * existing.h:
                    existing.x = candidate.x
                    existing.y = candidate.y
                    existing.w = candidate.w
                    existing.h = candidate.h
                    existing.red_pixels = candidate.red_pixels
                    existing.fill_brightness = candidate.fill_brightness
                break
        if not matched:
            deduped.append(candidate)

    deduped.sort(key=lambda item: (item.y, item.x))
    return deduped


def save_label_crop(image_bgr: np.ndarray, candidate: LabelCandidate, output_path: Path) -> None:
    margin_x = 6
    margin_y = 5
    x0 = max(0, candidate.x - margin_x)
    y0 = max(0, candidate.y - margin_y)
    x1 = min(image_bgr.shape[1], candidate.x + candidate.w + margin_x)
    y1 = min(image_bgr.shape[0], candidate.y + candidate.h + margin_y)
    crop = image_bgr[y0:y1, x0:x1]
    cv2.imwrite(str(output_path), crop)


def save_label_context_crop(image_bgr: np.ndarray, candidate: LabelCandidate, output_path: Path) -> None:
    margin_x = 80
    margin_y = 60
    x0 = max(0, candidate.x - margin_x)
    y0 = max(0, candidate.y - margin_y)
    x1 = min(image_bgr.shape[1], candidate.x + candidate.w + margin_x)
    y1 = min(image_bgr.shape[0], candidate.y + candidate.h + margin_y)
    crop = image_bgr[y0:y1, x0:x1]
    cv2.imwrite(str(output_path), crop)


def main() -> None:
    ensure_dirs()
    index_records = []

    for screenshot_path in sorted(SCREENSHOT_DIR.glob("Screenshot_2026032*.png")):
        image = cv2.imread(str(screenshot_path), cv2.IMREAD_COLOR)
        if image is None:
            continue

        game_crop = crop_game_window(image)
        game_crop_path = GAME_CROP_DIR / screenshot_path.name
        cv2.imwrite(str(game_crop_path), game_crop)
        title_crop = crop_title_strip(game_crop)
        title_text_crop = crop_title_text(title_crop)
        title_crop_path = TITLE_CROP_DIR / screenshot_path.name
        title_text_crop_path = TITLE_TEXT_CROP_DIR / screenshot_path.name
        cv2.imwrite(str(title_crop_path), title_crop)
        cv2.imwrite(str(title_text_crop_path), title_text_crop)
        title_identifier = compute_title_identifier(title_text_crop)

        candidates = detect_label_candidates(game_crop)
        candidate_records = []
        stem = screenshot_path.stem
        for index, candidate in enumerate(candidates, start=1):
            label_crop_path = LABEL_CROP_DIR / f"{stem}__label_{index:02d}.png"
            label_context_path = LABEL_CONTEXT_DIR / f"{stem}__context_{index:02d}.png"
            save_label_crop(game_crop, candidate, label_crop_path)
            save_label_context_crop(game_crop, candidate, label_context_path)
            candidate_records.append(
                {
                    "index": index,
                    "bbox": {
                        "x": candidate.x,
                        "y": candidate.y,
                        "w": candidate.w,
                        "h": candidate.h,
                    },
                    "redPixels": candidate.red_pixels,
                    "fillBrightness": round(candidate.fill_brightness, 2),
                    "labelCropPath": str(label_crop_path),
                    "labelContextPath": str(label_context_path),
                }
            )

        index_records.append(
            {
                "screenshotPath": str(screenshot_path),
                "gameCropPath": str(game_crop_path),
                "titleCropPath": str(title_crop_path),
                "titleTextCropPath": str(title_text_crop_path),
                "titleIdentifier": title_identifier,
                "candidateCount": len(candidate_records),
                "candidates": candidate_records,
            }
        )

    title_groups: dict[str, list[dict]] = {}
    for record in index_records:
        title_groups.setdefault(record["titleIdentifier"], []).append(record)

    sorted_title_ids = sorted(
        title_groups.keys(),
        key=lambda title_id: (-len(title_groups[title_id]), title_id),
    )
    title_group_ordinals = {title_id: index + 1 for index, title_id in enumerate(sorted_title_ids)}
    for record in index_records:
        group_records = title_groups[record["titleIdentifier"]]
        record["titleGroupId"] = f"group-{title_group_ordinals[record['titleIdentifier']]:03d}"
        record["titleGroupCount"] = len(group_records)

    payload = {
        "source": {
            "screenshotDir": str(SCREENSHOT_DIR),
            "generator": "scripts/extract-screenshot-teleporter-labels.py",
        },
        "summary": {
            "screenshotCount": len(index_records),
            "screenshotsWithCandidates": sum(1 for record in index_records if record["candidateCount"] > 0),
            "totalCandidateCount": sum(record["candidateCount"] for record in index_records),
            "titleIdentifierCount": len(title_groups),
            "duplicateTitleIdentifierCount": sum(1 for group in title_groups.values() if len(group) > 1),
        },
        "screenshots": index_records,
    }
    INDEX_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(INDEX_PATH)
    print(payload["summary"]["screenshotCount"])
    print(payload["summary"]["screenshotsWithCandidates"])
    print(payload["summary"]["totalCandidateCount"])


if __name__ == "__main__":
    main()
