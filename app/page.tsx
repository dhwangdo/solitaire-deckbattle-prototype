"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

type CardKind = "strike" | "defend" | "skill";
type DamageType = "physical" | "magic";
type CardRarity = "basic" | "special" | "rare";
type CardEffect =
  | "strike"
  | "pommel"
  | "defend"
  | "deflect"
  | "steelHeart"
  | "battlePlan"
  | "prepare"
  | "sweep"
  | "rulerCompass"
  | "berserk"
  | "transcend"
  | "rapidFire"
  | "iceShield"
  | "ironWave"
  | "waterWave"
  | "ironRampage";
type Phase = "drawing" | "playing" | "discarding" | "enemy-turn";
type Screen = "map" | "battle";
type MapPosition = { x: number; y: number };
type RoomType = "empty" | "combat";
type DeckEditorArea = "deck" | "inventory" | "floor";
type DeckCase = { id: string; name: string; capacity: number };

type Card = {
  id: number;
  kind: CardKind;
  effect: CardEffect;
  rarity: CardRarity;
  name: string;
  cost: number;
  value: number;
  draw: number;
  damageType: DamageType;
  revealed: boolean;
};

type DeckEditorSnapshot = {
  roomKey: string;
  deck: Card[];
  inventory: Card[];
  floor: Card[];
};

type EnemyAttack = {
  type: DamageType;
  value: number;
};

type EnemyState = {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  pattern: EnemyAttack[];
  awakenedAttack: EnemyAttack;
  intentIndex: number;
  passion: number;
  awakened: boolean;
  variant: "beast" | "goblin";
};

type GameState = {
  piles: Card[][];
  hand: Card[];
  discard: Card[];
  energy: number;
  stars: number;
  pendingDraws: number;
  pendingDiscards: number;
  pendingSweep: boolean;
  turn: number;
  playerHp: number;
  playerPhysicalBlock: number;
  playerMagicBlock: number;
  strength: number;
  defenseMultiplier: number;
  damageTakenMultiplier: number;
  invulnerable: boolean;
  doubleNextAttack: boolean;
  enemies: EnemyState[];
  status: "playing" | "won" | "lost";
  message: string;
  history: string[];
};

type DragState = {
  card: Card;
  cards: Card[];
  source: { type: "hand" } | { type: "pile"; pileIndex: number; cardIndex: number };
  x: number;
  y: number;
  moved: boolean;
};

type DamagePopup = {
  key: string;
  text: string;
};

const MAX_PLAYER_HP = 20;
const STARTING_DECK_SIZE = 20;
const STARTING_SPECIAL_CARD_COUNT = 5;
const INVENTORY_CAPACITY = 8;
const STARTER_DECK_CASE: DeckCase = { id: "starter", name: "시작 덱 케이스", capacity: 25 };
const MAP_COLUMNS = 15;
const MAP_ROWS = 60;
const MAP_ROOM_WIDTH = 204;
const MAP_ROOM_HEIGHT = 136;
const MAP_CELL_GAP = 20;
const MAP_PADDING = 42;
const MAP_MIN_ZOOM = 0.45;
const MAP_MAX_ZOOM = 1.35;
const MAP_ZOOM_STEP = 0.1;
const MAP_START: MapPosition = { x: Math.floor(MAP_COLUMNS / 2), y: 0 };
const CARD_HEIGHT = 144;
const PILE_HEIGHT = 226;
const DEFAULT_STACK_OFFSET = 18;
const MAX_STACK_TRAVEL = PILE_HEIGHT - CARD_HEIGHT;

function getStackOffset(cardCount: number) {
  if (cardCount <= 1) return DEFAULT_STACK_OFFSET;
  return Math.min(DEFAULT_STACK_OFFSET, MAX_STACK_TRAVEL / (cardCount - 1));
}

function mapRoomKey(position: MapPosition) {
  return `${position.x}:${position.y}`;
}

function getRoomType(position: MapPosition, seed: number): RoomType {
  if (position.x === MAP_START.x && position.y === MAP_START.y) return "empty";
  let hash = Math.imul(position.x + 17, 374761393)
    ^ Math.imul(position.y + 29, 668265263)
    ^ Math.imul(seed + 11, 1442695041);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  const roll = ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
  return roll < 0.35 ? "combat" : "empty";
}

const ATTACK_LABEL: Record<DamageType, string> = {
  physical: "공격",
  magic: "마법 공격",
};
const DEFENSE_LABEL: Record<DamageType, string> = {
  physical: "방어",
  magic: "마법 방어",
};

function createEnemies(): EnemyState[] {
  return [
    {
      id: "beast",
      name: "훈련용 괴수",
      hp: 1,
      maxHp: 1,
      pattern: [
        { type: "physical", value: 6 },
        { type: "physical", value: 8 },
        { type: "magic", value: 5 },
      ],
      awakenedAttack: { type: "physical", value: 13 },
      intentIndex: 0,
      passion: 0,
      awakened: false,
      variant: "beast",
    },
    {
      id: "goblin",
      name: "숲 고블린",
      hp: 1,
      maxHp: 1,
      pattern: [
        { type: "magic", value: 5 },
        { type: "physical", value: 7 },
        { type: "magic", value: 9 },
      ],
      awakenedAttack: { type: "magic", value: 12 },
      intentIndex: 0,
      passion: 0,
      awakened: false,
      variant: "goblin",
    },
  ];
}

type CardBlueprint = Omit<Card, "id" | "revealed">;

const SPECIAL_CARD_POOL: CardBlueprint[] = [
  { kind: "strike", effect: "pommel", rarity: "special", name: "폼멜 타격", cost: 1, value: 6, draw: 1, damageType: "physical" },
  { kind: "defend", effect: "deflect", rarity: "special", name: "흘려보내기", cost: 1, value: 5, draw: 1, damageType: "physical" },
  { kind: "skill", effect: "battlePlan", rarity: "special", name: "전투 설계", cost: 1, value: 0, draw: 0, damageType: "physical" },
  { kind: "skill", effect: "prepare", rarity: "special", name: "예비", cost: 0, value: 0, draw: 1, damageType: "physical" },
  { kind: "skill", effect: "sweep", rarity: "special", name: "걷어내기", cost: 1, value: 0, draw: 0, damageType: "physical" },
  { kind: "strike", effect: "rulerCompass", rarity: "special", name: "자와 컴퍼스", cost: 1, value: 6, draw: 0, damageType: "physical" },
  { kind: "skill", effect: "berserk", rarity: "special", name: "광폭화", cost: 0, value: 0, draw: 0, damageType: "physical" },
  { kind: "defend", effect: "iceShield", rarity: "special", name: "얼음 방패", cost: 1, value: 8, draw: 0, damageType: "magic" },
  { kind: "strike", effect: "ironWave", rarity: "special", name: "철의 파동", cost: 1, value: 5, draw: 0, damageType: "physical" },
  { kind: "strike", effect: "waterWave", rarity: "special", name: "물의 파동", cost: 1, value: 5, draw: 0, damageType: "magic" },
  { kind: "strike", effect: "ironRampage", rarity: "special", name: "무쇠 난동", cost: 2, value: 8, draw: 0, damageType: "physical" },
];

const RARE_CARD_POOL: CardBlueprint[] = [
  { kind: "skill", effect: "steelHeart", rarity: "rare", name: "강철심장", cost: 1, value: 0, draw: 0, damageType: "physical" },
  { kind: "skill", effect: "transcend", rarity: "rare", name: "초월", cost: 4, value: 0, draw: 0, damageType: "physical" },
  { kind: "skill", effect: "rapidFire", rarity: "rare", name: "연사", cost: 1, value: 0, draw: 0, damageType: "physical" },
];

function createBattleRewards(startId: number): Card[] {
  const weightedPool = [
    ...SPECIAL_CARD_POOL.map((card) => ({ card, weight: 1 })),
    ...RARE_CARD_POOL.map((card) => ({ card, weight: 0.5 })),
  ];
  const totalWeight = weightedPool.reduce((total, entry) => total + entry.weight, 0);
  return Array.from({ length: 2 }, (_, index) => {
    let roll = Math.random() * totalWeight;
    const selected = weightedPool.find((entry) => {
      roll -= entry.weight;
      return roll < 0;
    }) ?? weightedPool.at(-1)!;
    return { ...selected.card, id: startId + index, revealed: false };
  });
}

function createDeck(): Card[] {
  const make = (
    count: number,
    blueprint: CardBlueprint,
  ) => Array.from({ length: count }, () => ({ ...blueprint }));
  const randomSpecialCards = shuffle(SPECIAL_CARD_POOL).slice(0, STARTING_SPECIAL_CARD_COUNT);
  const blueprints: CardBlueprint[] = [
    ...make(5, { kind: "strike", effect: "strike", rarity: "basic", name: "타격", cost: 1, value: 6, draw: 0, damageType: "physical" }),
    ...make(5, { kind: "defend", effect: "defend", rarity: "basic", name: "방어", cost: 1, value: 5, draw: 0, damageType: "physical" }),
    ...make(5, { kind: "defend", effect: "defend", rarity: "basic", name: "마법 방어", cost: 1, value: 5, draw: 0, damageType: "magic" }),
    ...randomSpecialCards,
  ];
  if (blueprints.length !== STARTING_DECK_SIZE) {
    throw new Error(`Starting deck must contain ${STARTING_DECK_SIZE} cards.`);
  }
  return blueprints.map((card, id) => ({ ...card, id, revealed: false }));
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function buildPiles(cards: Card[]): Card[][] {
  const piles: Card[][] = [];
  for (let index = 0; index < cards.length; index += 5) {
    const pile = cards.slice(index, index + 5).map((card) => ({ ...card, revealed: false }));
    if (pile.length > 0) pile[pile.length - 1].revealed = true;
    piles.push(pile);
  }
  return piles;
}

function drawFromPiles(piles: Card[][]) {
  const nextPiles = piles.map((pile) => [...pile]);
  const hand: Card[] = [];
  nextPiles.forEach((pile) => {
    const card = pile.pop();
    if (card) hand.push({ ...card, revealed: true });
    if (pile.length > 0) {
      pile[pile.length - 1] = { ...pile[pile.length - 1], revealed: true };
    }
  });
  return { piles: nextPiles, hand };
}

function waitingState(playerHp = MAX_PLAYER_HP): GameState {
  return {
    piles: [],
    hand: [],
    discard: [],
    energy: 3,
    stars: 2,
    pendingDraws: 0,
    pendingDiscards: 0,
    pendingSweep: false,
    turn: 1,
    playerHp,
    playerPhysicalBlock: 0,
    playerMagicBlock: 0,
    strength: 0,
    defenseMultiplier: 1,
    damageTakenMultiplier: 1,
    invulnerable: false,
    doubleNextAttack: false,
    enemies: createEnemies(),
    status: "playing",
    message: "카드를 준비하고 있습니다.",
    history: [],
  };
}

function dealtState(playerHp = MAX_PLAYER_HP, deck = createDeck()): GameState {
  return {
    ...waitingState(playerHp),
    piles: buildPiles(shuffle(deck.map((card) => ({ ...card, revealed: false })))),
    message: "파일 배치 완료 — 맨 위 카드를 가져옵니다.",
  };
}

function CardFace({ card }: { card: Card }) {
  const effectText = (() => {
    switch (card.effect) {
      case "strike":
        return <span className="effect-type damage">피해 {card.value}</span>;
      case "pommel":
        return <><span className="effect-type damage">피해 {card.value}</span><span>1 드로우</span></>;
      case "defend":
        return <span className={`effect-type ${card.damageType}`}>{DEFENSE_LABEL[card.damageType]} {card.value}</span>;
      case "deflect":
        return <><span className="effect-type physical">방어 {card.value}</span><span>1 드로우</span></>;
      case "steelHeart":
        return <span>이번 턴 동안 얻는<br /><span className="effect-type physical">방어</span>/<span className="effect-type magic">마법 방어</span> 3배</span>;
      case "battlePlan":
        return <span>★★★를 얻습니다</span>;
      case "prepare":
        return <span>1장 뽑고<br />1장 버립니다</span>;
      case "sweep":
        return <span>파일 하나를 전부<br />손으로 가져옵니다</span>;
      case "rulerCompass":
        return <><span className="effect-type damage">피해 {card.value}</span><span>★를 얻습니다</span></>;
      case "berserk":
        return <span>에너지 2 획득<br />이번 턴 받는 피해 2배</span>;
      case "transcend":
        return <span>이번 턴 피해 면역<br />힘 5를 얻습니다</span>;
      case "rapidFire":
        return <span>다음 공격 카드가<br />한 번 더 발동</span>;
      case "iceShield":
        return <><span className="effect-type magic">마법 방어 {card.value}</span><span>★를 얻습니다</span></>;
      case "ironWave":
        return <><span className="effect-type damage">피해 {card.value}</span><span className="effect-type physical">방어 5</span></>;
      case "waterWave":
        return <><span className="effect-type damage">피해 {card.value}</span><span className="effect-type magic">마법 방어 5</span></>;
      case "ironRampage":
        return <><span className="effect-type damage">적 전체 피해 {card.value}</span><span className="effect-type physical">방어 5</span></>;
    }
  })();
  return (
    <>
      <span className="card-cost">{card.cost}</span>
      <strong className={`card-name rarity-${card.rarity} ${card.name.length >= 6 ? "is-long" : ""}`}>{card.name}</strong>
      <span className="card-effect">{effectText}</span>
    </>
  );
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("map");
  const [runPlayerHp, setRunPlayerHp] = useState(MAX_PLAYER_HP);
  const [mapSeed, setMapSeed] = useState(1);
  const [mapPosition, setMapPosition] = useState<MapPosition>(MAP_START);
  const [visitedRooms, setVisitedRooms] = useState<Set<string>>(
    () => new Set([mapRoomKey(MAP_START)]),
  );
  const [clearedCombats, setClearedCombats] = useState<Set<string>>(() => new Set());
  const [activeBattleRoom, setActiveBattleRoom] = useState<string | null>(null);
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 });
  const [mapZoom, setMapZoom] = useState(1);
  const [deckCards, setDeckCards] = useState<Card[]>(createDeck);
  const [inventoryCards, setInventoryCards] = useState<Card[]>([]);
  const [roomDrops, setRoomDrops] = useState<Record<string, Card[]>>({});
  const [battleRewards, setBattleRewards] = useState<Card[]>([]);
  const [deckEditorOpen, setDeckEditorOpen] = useState(false);
  const [deckEditorDrag, setDeckEditorDrag] = useState<{ cardId: number; source: DeckEditorArea } | null>(null);
  const [deckEditorDropTarget, setDeckEditorDropTarget] = useState<DeckEditorArea | null>(null);
  const [deckEditorMessage, setDeckEditorMessage] = useState("인벤토리 카드는 덱에 넣을 수 있고, 덱 카드는 우클릭으로 제거합니다.");
  const [deckEditorSnapshot, setDeckEditorSnapshot] = useState<DeckEditorSnapshot | null>(null);
  const [pendingRemovedCards, setPendingRemovedCards] = useState<Card[]>([]);
  const [hoveredDeckCard, setHoveredDeckCard] = useState<Card | null>(null);
  const [game, setGame] = useState<GameState>(waitingState);
  const [phase, setPhase] = useState<Phase>("drawing");
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [lockedEnemyId, setLockedEnemyId] = useState<string | null>(null);
  const [attackingEnemyId, setAttackingEnemyId] = useState<string | null>(null);
  const [damagePopup, setDamagePopup] = useState<DamagePopup | null>(null);
  const pendingOriginsRef = useRef(new Map<number, DOMRect>());
  const handCardRefs = useRef(new Map<number, HTMLButtonElement>());
  const dragRef = useRef<DragState & { startX: number; startY: number } | null>(null);
  const timersRef = useRef<number[]>([]);
  const mapViewportRef = useRef<HTMLDivElement | null>(null);
  const mapDragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const mapWasDraggedRef = useRef(false);

  const later = (callback: () => void, delay: number) => {
    const timer = window.setTimeout(callback, delay);
    timersRef.current.push(timer);
    return timer;
  };

  const drawCards = () => {
    const origins = new Map<number, DOMRect>();
    document.querySelectorAll<HTMLElement>("[data-top-card-id]").forEach((element) => {
      const cardId = Number(element.dataset.topCardId);
      origins.set(cardId, element.getBoundingClientRect());
    });
    pendingOriginsRef.current = origins;
    setPhase("drawing");
    setGame((current) => {
      const draw = drawFromPiles(current.piles);
      return {
        ...current,
        piles: draw.piles,
        hand: draw.hand,
        energy: 3,
        pendingDraws: 0,
        pendingDiscards: 0,
        pendingSweep: false,
        playerPhysicalBlock: 0,
        playerMagicBlock: 0,
        defenseMultiplier: 1,
        damageTakenMultiplier: 1,
        invulnerable: false,
        message: `${draw.hand.length}장을 각 파일에서 가져왔습니다.`,
        history: [`${current.turn}턴: ${draw.hand.length}장 드로우`, ...current.history].slice(0, 5),
      };
    });
  };

  const clearBattleTimers = () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  };

  const startBattle = (playerHp = runPlayerHp) => {
    clearBattleTimers();
    setDeckEditorOpen(false);
    setDragging(null);
    setLockedEnemyId(null);
    setAttackingEnemyId(null);
    setDamagePopup(null);
    setBattleRewards([]);
    setPhase("drawing");
    setGame(dealtState(playerHp, deckCards));
    setScreen("battle");
    later(drawCards, 360);
  };

  useEffect(() => {
    return () => {
      clearBattleTimers();
    };
  }, []);

  const centerMapOn = (position: MapPosition) => {
    const viewport = mapViewportRef.current;
    if (!viewport) return;
    const roomCenterX = MAP_PADDING + position.x * (MAP_ROOM_WIDTH + MAP_CELL_GAP) + MAP_ROOM_WIDTH / 2;
    const roomCenterY = MAP_PADDING + position.y * (MAP_ROOM_HEIGHT + MAP_CELL_GAP) + MAP_ROOM_HEIGHT / 2;
    setMapPan({
      x: viewport.clientWidth / 2 - roomCenterX * mapZoom,
      y: viewport.clientHeight / 2 - roomCenterY * mapZoom,
    });
  };

  const moveOnMap = (deltaX: number, deltaY: number) => {
    if (screen !== "map") return;
    const nextPosition = {
      x: mapPosition.x + deltaX,
      y: mapPosition.y + deltaY,
    };
    if (
      nextPosition.x < 0
      || nextPosition.x >= MAP_COLUMNS
      || nextPosition.y < 0
      || nextPosition.y >= MAP_ROWS
    ) return;

    const roomKey = mapRoomKey(nextPosition);
    setMapPosition(nextPosition);
    setVisitedRooms((current) => new Set(current).add(roomKey));

    if (getRoomType(nextPosition, mapSeed) === "combat" && !clearedCombats.has(roomKey)) {
      setActiveBattleRoom(roomKey);
      startBattle(runPlayerHp);
    }
  };

  const returnToMap = () => {
    if (activeBattleRoom) {
      const landingDrops = [...(roomDrops[activeBattleRoom] ?? []), ...battleRewards];
      setClearedCombats((current) => new Set(current).add(activeBattleRoom));
      setRoomDrops((current) => ({
        ...current,
        [activeBattleRoom]: landingDrops,
      }));
    }
    setRunPlayerHp(game.playerHp);
    setBattleRewards([]);
    setActiveBattleRoom(null);
    setScreen("map");
  };

  const startNewRun = () => {
    clearBattleTimers();
    const nextSeed = mapSeed + 1;
    const startingDeck = createDeck();
    setRunPlayerHp(MAX_PLAYER_HP);
    setMapSeed(nextSeed);
    setMapPosition(MAP_START);
    setVisitedRooms(new Set([mapRoomKey(MAP_START)]));
    setClearedCombats(new Set());
    setActiveBattleRoom(null);
    setDeckCards(startingDeck);
    setInventoryCards([]);
    setRoomDrops({});
    setBattleRewards([]);
    setDeckEditorOpen(false);
    setDeckEditorSnapshot(null);
    setPendingRemovedCards([]);
    setHoveredDeckCard(null);
    setGame(waitingState());
    setPhase("drawing");
    setScreen("map");
  };

  const removeDeckCard = (cardId: number) => {
    if (deckCards.length <= 1) {
      setDeckEditorMessage("덱에는 반드시 카드가 1장 이상 있어야 합니다.");
      return;
    }
    const card = deckCards.find((item) => item.id === cardId);
    if (!card) return;
    setDeckCards((current) => current.filter((item) => item.id !== cardId));
    setPendingRemovedCards((current) => [...current, card]);
    setHoveredDeckCard(null);
    setDeckEditorMessage(`${card.name}을(를) 덱에서 제거했습니다. 편집 확인 시 영구 제거됩니다.`);
  };

  const restoreRemovedCard = (cardId: number) => {
    if (deckCards.length >= STARTER_DECK_CASE.capacity) {
      setDeckEditorMessage(`${STARTER_DECK_CASE.name}에는 최대 ${STARTER_DECK_CASE.capacity}장까지 넣을 수 있습니다.`);
      return;
    }
    const card = pendingRemovedCards.find((item) => item.id === cardId);
    if (!card) return;
    setPendingRemovedCards((current) => current.filter((item) => item.id !== cardId));
    setDeckCards((current) => [...current, card]);
    setDeckEditorMessage(`${card.name} 제거를 취소하고 덱으로 돌렸습니다.`);
  };

  const moveInventoryCardToDeck = (cardId: number) => {
    if (deckCards.length >= STARTER_DECK_CASE.capacity) {
      setDeckEditorMessage(`${STARTER_DECK_CASE.name}에는 최대 ${STARTER_DECK_CASE.capacity}장까지 넣을 수 있습니다.`);
      return;
    }
    const card = inventoryCards.find((item) => item.id === cardId);
    if (!card) return;
    setInventoryCards((current) => current.filter((item) => item.id !== cardId));
    setDeckCards((current) => [...current, card]);
    setDeckEditorMessage(`${card.name}을(를) 덱에 넣었습니다.`);
  };

  const moveInventoryCardToFloor = (cardId: number) => {
    const card = inventoryCards.find((item) => item.id === cardId);
    if (!card) return;
    const roomKey = mapRoomKey(mapPosition);
    setInventoryCards((current) => current.filter((item) => item.id !== cardId));
    setRoomDrops((current) => ({
      ...current,
      [roomKey]: [...(current[roomKey] ?? []), card],
    }));
    setDeckEditorMessage(`${card.name}을(를) 바닥에 놓았습니다.`);
  };

  const moveFloorCardToInventory = (cardId: number) => {
    const roomKey = mapRoomKey(mapPosition);
    const card = (roomDrops[roomKey] ?? []).find((item) => item.id === cardId);
    if (!card) return;
    setRoomDrops((current) => ({
      ...current,
      [roomKey]: (current[roomKey] ?? []).filter((item) => item.id !== cardId),
    }));
    setInventoryCards((current) => [...current, card]);
    setDeckEditorMessage(`${card.name}을(를) 인벤토리에 주웠습니다.`);
  };

  const beginDeckEditorDrag = (
    event: ReactDragEvent<HTMLElement>,
    cardId: number,
    source: DeckEditorArea,
  ) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `${source}:${cardId}`);
    setDeckEditorDrag({ cardId, source });
    setDeckEditorDropTarget(null);
  };

  const dropDeckEditorCard = (event: ReactDragEvent<HTMLElement>, target: DeckEditorArea) => {
    event.preventDefault();
    const [payloadSource, payloadId] = event.dataTransfer.getData("text/plain").split(":");
    const source = deckEditorDrag?.source ?? (payloadSource as DeckEditorArea);
    const cardId = deckEditorDrag?.cardId ?? Number(payloadId);
    if (source !== target && Number.isInteger(cardId)) {
      if (source === "inventory" && target === "deck") moveInventoryCardToDeck(cardId);
      else if (source === "inventory" && target === "floor") moveInventoryCardToFloor(cardId);
      else if (source === "floor" && target === "inventory") moveFloorCardToInventory(cardId);
    }
    setDeckEditorDrag(null);
    setDeckEditorDropTarget(null);
  };

  const finishDeckEditorDrag = () => {
    setDeckEditorDrag(null);
    setDeckEditorDropTarget(null);
  };

  const openDeckEditor = (message: string) => {
    const roomKey = mapRoomKey(mapPosition);
    finishDeckEditorDrag();
    setPendingRemovedCards([]);
    setHoveredDeckCard(null);
    setDeckEditorSnapshot({
      roomKey,
      deck: [...deckCards],
      inventory: [...inventoryCards],
      floor: [...(roomDrops[roomKey] ?? [])],
    });
    setDeckEditorMessage(message);
    setDeckEditorOpen(true);
  };

  const confirmDeckEditor = () => {
    if (inventoryCards.length > INVENTORY_CAPACITY) {
      setDeckEditorMessage(`인벤토리를 ${INVENTORY_CAPACITY}장 이하로 줄여야 편집을 확인할 수 있습니다.`);
      return;
    }
    setDeckEditorSnapshot(null);
    setPendingRemovedCards([]);
    setHoveredDeckCard(null);
    finishDeckEditorDrag();
    setDeckEditorOpen(false);
  };

  const cancelDeckEditor = () => {
    if (deckEditorSnapshot) {
      setDeckCards(deckEditorSnapshot.deck);
      setInventoryCards(deckEditorSnapshot.inventory);
      setRoomDrops((current) => ({
        ...current,
        [deckEditorSnapshot.roomKey]: deckEditorSnapshot.floor,
      }));
    }
    setDeckEditorSnapshot(null);
    setPendingRemovedCards([]);
    setHoveredDeckCard(null);
    finishDeckEditorDrag();
    setDeckEditorOpen(false);
  };

  const beginMapDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    mapWasDraggedRef.current = false;
    mapDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: mapPan.x,
      originY: mapPan.y,
      moved: false,
    };
  };

  const moveMapDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = mapDragRef.current;
    if (!drag) return;
    const offsetX = event.clientX - drag.startX;
    const offsetY = event.clientY - drag.startY;
    const moved = drag.moved || Math.hypot(offsetX, offsetY) > 6;
    mapDragRef.current = { ...drag, moved };
    mapWasDraggedRef.current = moved;
    setMapPan({ x: drag.originX + offsetX, y: drag.originY + offsetY });
  };

  const finishMapDrag = () => {
    mapDragRef.current = null;
  };

  const zoomMap = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const viewport = mapViewportRef.current;
    if (!viewport) return;
    const direction = event.deltaY < 0 ? 1 : -1;
    const nextZoom = Math.min(
      MAP_MAX_ZOOM,
      Math.max(MAP_MIN_ZOOM, Number((mapZoom + direction * MAP_ZOOM_STEP).toFixed(2))),
    );
    if (nextZoom === mapZoom) return;

    const bounds = viewport.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    const mapX = (pointerX - mapPan.x) / mapZoom;
    const mapY = (pointerY - mapPan.y) / mapZoom;
    setMapPan({
      x: pointerX - mapX * nextZoom,
      y: pointerY - mapY * nextZoom,
    });
    setMapZoom(nextZoom);
  };

  useLayoutEffect(() => {
    if (screen !== "map") return;
    const frame = window.requestAnimationFrame(() => centerMapOn(mapPosition));
    return () => window.cancelAnimationFrame(frame);
  }, [screen, mapPosition]);

  useLayoutEffect(() => {
    const origins = pendingOriginsRef.current;
    if (origins.size === 0 || game.hand.length === 0) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      origins.clear();
      const frame = window.requestAnimationFrame(() => setPhase("playing"));
      return () => window.cancelAnimationFrame(frame);
    }

    game.hand.forEach((card, index) => {
      const source = origins.get(card.id);
      const target = handCardRefs.current.get(card.id);
      if (!source || !target) return;
      const targetRect = target.getBoundingClientRect();
      target.style.zIndex = String(20 + index);
      target.animate(
        [
          {
            transform: `translate(${source.left - targetRect.left}px, ${source.top - targetRect.top}px)`,
            boxShadow: "0 2px 4px rgba(0,0,0,.28)",
          },
          {
            transform: "translate(0, 0)",
            boxShadow: "0 7px 14px rgba(0,0,0,.3)",
          },
        ],
        {
          duration: 480,
          delay: index * 65,
          easing: "cubic-bezier(.2,.72,.25,1)",
          fill: "backwards",
        },
      );
    });

    origins.clear();
    const finishDelay = 500 + Math.max(0, game.hand.length - 1) * 65;
    const timer = window.setTimeout(() => {
      handCardRefs.current.forEach((element) => { element.style.zIndex = ""; });
      setPhase("playing");
    }, finishDelay);
    return () => window.clearTimeout(timer);
  }, [game.hand]);

  useEffect(() => {
    if (!lockedEnemyId) return;
    const target = game.enemies.find((enemy) => enemy.id === lockedEnemyId);
    if (!target || target.hp === 0) {
      const frame = window.requestAnimationFrame(() => setLockedEnemyId(null));
      return () => window.cancelAnimationFrame(frame);
    }
  }, [game.enemies, lockedEnemyId]);

  const playCard = (card: Card, targetEnemyId?: string) => {
    const isRewardAttack = card.kind === "strike";
    const isRewardAttackAll = card.effect === "ironRampage";
    const rewardTarget = game.enemies.find((enemy) => enemy.id === targetEnemyId);
    const canResolveRewardAttack = isRewardAttack
      && game.status === "playing"
      && phase === "playing"
      && game.pendingDraws === 0
      && game.pendingDiscards === 0
      && !game.pendingSweep
      && game.energy >= card.cost
      && (isRewardAttackAll || Boolean(rewardTarget && rewardTarget.hp > 0));
    if (canResolveRewardAttack) {
      const repetitions = game.doubleNextAttack ? 2 : 1;
      const damage = (card.value + game.strength) * repetitions;
      const enemiesAfterAttack = game.enemies.map((enemy) => isRewardAttackAll || enemy.id === targetEnemyId
        ? { ...enemy, hp: Math.max(0, enemy.hp - damage) }
        : enemy);
      if (enemiesAfterAttack.every((enemy) => enemy.hp === 0)) {
        const ownedCards = [...deckCards, ...inventoryCards, ...Object.values(roomDrops).flat()];
        const nextId = ownedCards.reduce((highest, ownedCard) => Math.max(highest, ownedCard.id), -1) + 1;
        setBattleRewards(createBattleRewards(nextId));
      }
    }

    setGame((current) => {
      if (
        current.status !== "playing" ||
        current.pendingDraws > 0 ||
        current.pendingDiscards > 0 ||
        current.pendingSweep ||
        phase !== "playing"
      ) return current;
      if (current.energy < card.cost) {
        return { ...current, message: `${card.name}: 에너지가 ${card.cost} 필요합니다.` };
      }
      const isIronRampage = card.effect === "ironRampage";
      const isWave = card.effect === "ironWave" || card.effect === "waterWave";
      if (card.kind === "strike" && !isIronRampage && !targetEnemyId) return current;
      const targetEnemy = current.enemies.find((enemy) => enemy.id === targetEnemyId);
      if (card.kind === "strike" && !isIronRampage && (!targetEnemy || targetEnemy.hp === 0)) return current;
      const repetitions = card.kind === "strike" && current.doubleNextAttack ? 2 : 1;
      const damage = card.kind === "strike" ? (card.value + current.strength) * repetitions : 0;
      const nextEnemies = card.kind === "strike"
        ? current.enemies.map((enemy) => isIronRampage || enemy.id === targetEnemyId
          ? { ...enemy, hp: Math.max(0, enemy.hp - damage) }
          : enemy)
        : current.enemies;
      const blockGained = card.kind === "defend"
        ? card.value * current.defenseMultiplier
        : isIronRampage || isWave
          ? 5 * repetitions * current.defenseMultiplier
          : 0;
      const nextPhysicalBlock = (card.kind === "defend" && card.damageType === "physical")
        || isIronRampage
        || (isWave && card.damageType === "physical")
        ? current.playerPhysicalBlock + blockGained
        : current.playerPhysicalBlock;
      const nextMagicBlock = (card.kind === "defend" && card.damageType === "magic")
        || (isWave && card.damageType === "magic")
        ? current.playerMagicBlock + blockGained
        : current.playerMagicBlock;
      const won = nextEnemies.every((enemy) => enemy.hp === 0);
      const canDraw = current.piles.some((pile) => pile.length > 0);
      const drawsAdded = !won && canDraw ? card.draw * repetitions : 0;
      const remainingHand = current.hand.filter((item) => item.id !== card.id);
      const pendingDiscards = card.effect === "prepare" && (canDraw || remainingHand.length > 0) ? 1 : 0;
      const pendingSweep = card.effect === "sweep" && canDraw;
      const action = (() => {
        if (isIronRampage) return `적 전체에게 피해 ${damage} · 방어 ${blockGained}${repetitions > 1 ? " (2회 발동)" : ""}`;
        if (isWave) return `${targetEnemy?.name}에게 피해 ${damage} · ${DEFENSE_LABEL[card.damageType]} ${blockGained}${repetitions > 1 ? " (2회 발동)" : ""}`;
        if (card.kind === "strike") return `${targetEnemy?.name}에게 피해 ${damage}${repetitions > 1 ? " (2회 발동)" : ""}`;
        if (card.kind === "defend") return `${DEFENSE_LABEL[card.damageType]} ${blockGained} 획득`;
        if (card.effect === "steelHeart") return "이번 턴 방어와 마법 방어 획득량 3배";
        if (card.effect === "battlePlan") return "★ 3개 획득";
        if (card.effect === "prepare") return canDraw ? "드로우할 파일을 선택하세요." : "버릴 카드를 선택하세요.";
        if (card.effect === "sweep") return canDraw ? "가져올 파일을 선택하세요." : "가져올 카드가 없습니다.";
        if (card.effect === "berserk") return "에너지 2 획득 · 이번 턴 받는 피해 2배";
        if (card.effect === "transcend") return "이번 턴 피해 면역 · 힘 5 획득";
        if (card.effect === "rapidFire") return "다음 공격 카드가 2회 발동";
        return card.name;
      })();
      const drawMessage = card.draw > 0
        ? canDraw
          ? " · 드로우할 파일을 선택하세요."
          : " · 드로우할 카드가 없습니다."
        : "";
      return {
        ...current,
        hand: remainingHand,
        discard: [...current.discard, card],
        piles: current.piles,
        energy: current.energy - card.cost + (card.effect === "berserk" ? 2 : 0),
        stars: current.stars + (
          card.effect === "battlePlan"
            ? 3
            : card.effect === "rulerCompass"
              ? repetitions
              : card.effect === "iceShield"
                ? 1
                : 0
        ),
        pendingDraws: drawsAdded,
        pendingDiscards,
        pendingSweep,
        enemies: nextEnemies,
        playerPhysicalBlock: nextPhysicalBlock,
        playerMagicBlock: nextMagicBlock,
        strength: current.strength + (card.effect === "transcend" ? 5 : 0),
        defenseMultiplier: card.effect === "steelHeart" ? 3 : current.defenseMultiplier,
        damageTakenMultiplier: card.effect === "berserk" ? 2 : current.damageTakenMultiplier,
        invulnerable: card.effect === "transcend" || current.invulnerable,
        doubleNextAttack: card.effect === "rapidFire"
          ? true
          : card.kind === "strike"
            ? false
            : current.doubleNextAttack,
        status: won ? "won" : current.status,
        message: won ? "승리! 모든 적을 쓰러뜨렸습니다." : `${action}${card.effect === "prepare" ? "" : drawMessage}`,
        history: [action, ...current.history].slice(0, 5),
      };
    });
  };

  const drawSelectedPile = (pileIndex: number) => {
    if (game.pendingDraws < 1 || phase !== "playing" || game.status !== "playing") return;
    const pile = game.piles[pileIndex];
    const card = pile?.at(-1);
    if (!card) return;

    const source = document.querySelector<HTMLElement>(`[data-top-card-id="${card.id}"]`);
    if (source) {
      pendingOriginsRef.current = new Map([[card.id, source.getBoundingClientRect()]]);
      setPhase("drawing");
    }

    setGame((current) => {
      if (current.pendingDraws < 1 || current.piles[pileIndex]?.at(-1)?.id !== card.id) return current;
      const nextPiles = current.piles.map((currentPile) => [...currentPile]);
      const drawnCard = nextPiles[pileIndex].pop();
      if (!drawnCard) return current;
      const revealedCard = { ...drawnCard, revealed: true };
      if (nextPiles[pileIndex].length > 0) {
        const nextTopIndex = nextPiles[pileIndex].length - 1;
        nextPiles[pileIndex][nextTopIndex] = {
          ...nextPiles[pileIndex][nextTopIndex],
          revealed: true,
        };
      }
      const action = `${pileIndex + 1}번 파일에서 ${revealedCard.name} 드로우`;
      return {
        ...current,
        piles: nextPiles,
        hand: [...current.hand, revealedCard],
        pendingDraws: current.pendingDraws - 1,
        message: current.pendingDraws > 1
          ? "다음 드로우 파일을 선택하세요."
          : current.pendingDiscards > 0
            ? "손에서 버릴 카드 1장을 클릭하세요."
            : action,
        history: [action, ...current.history].slice(0, 5),
      };
    });
  };

  const discardSelectedCard = (cardId: number) => {
    setGame((current) => {
      if (current.pendingDiscards < 1 || phase !== "playing") return current;
      const card = current.hand.find((item) => item.id === cardId);
      if (!card) return current;
      const action = `${card.name} 버림`;
      return {
        ...current,
        hand: current.hand.filter((item) => item.id !== cardId),
        discard: [...current.discard, card],
        pendingDiscards: current.pendingDiscards - 1,
        message: action,
        history: [action, ...current.history].slice(0, 5),
      };
    });
  };

  const takeSelectedPile = (pileIndex: number) => {
    if (!game.pendingSweep || phase !== "playing" || game.status !== "playing") return;
    const pile = game.piles[pileIndex];
    if (!pile?.length) return;
    const origins = new Map<number, DOMRect>();
    document.querySelectorAll<HTMLElement>(`[data-pile-index="${pileIndex}"] [data-card-id]`).forEach((element) => {
      origins.set(Number(element.dataset.cardId), element.getBoundingClientRect());
    });
    pendingOriginsRef.current = origins;
    setPhase("drawing");
    setGame((current) => {
      if (!current.pendingSweep || !current.piles[pileIndex]?.length) return current;
      const nextPiles = current.piles.map((currentPile) => [...currentPile]);
      const cards = nextPiles[pileIndex].map((card) => ({ ...card, revealed: true }));
      nextPiles[pileIndex] = [];
      const action = `${pileIndex + 1}번 파일 ${cards.length}장을 손으로 가져옴`;
      return {
        ...current,
        piles: nextPiles,
        hand: [...current.hand, ...cards],
        pendingSweep: false,
        message: action,
        history: [action, ...current.history].slice(0, 5),
      };
    });
  };

  const beginDrag = (
    event: ReactPointerEvent<HTMLElement>,
    card: Card,
    source: DragState["source"] = { type: "hand" },
    cards: Card[] = [card],
  ) => {
    if (
      game.status !== "playing" ||
      game.pendingDraws > 0 ||
      game.pendingDiscards > 0 ||
      game.pendingSweep ||
      phase !== "playing"
    ) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const nextDrag = {
      card,
      cards,
      source,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    dragRef.current = nextDrag;
    setDragging(nextDrag);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const current = dragRef.current;
    if (!current) return;
    const moved = current.moved || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 7;
    const nextDrag = { ...current, x: event.clientX, y: event.clientY, moved };
    dragRef.current = nextDrag;
    setDragging(nextDrag);
  };

  const moveCardToPile = (drag: DragState, targetPileIndex: number) => {
    setGame((current) => {
      if (
        current.status !== "playing" ||
        current.pendingDraws > 0 ||
        current.pendingDiscards > 0 ||
        current.pendingSweep ||
        phase !== "playing"
      ) return current;
      if (!current.piles[targetPileIndex]) return current;
      if (drag.source.type === "pile" && drag.source.pileIndex === targetPileIndex) return current;
      if (current.stars < 1) {
        return { ...current, message: "솔리테어 행동에 필요한 ★가 없습니다." };
      }

      const nextPiles = current.piles.map((pile) => [...pile]);
      if (drag.source.type === "pile") {
        const sourcePile = nextPiles[drag.source.pileIndex];
        const movingCards = sourcePile.slice(drag.source.cardIndex);
        if (
          movingCards.length !== drag.cards.length ||
          movingCards.some((card, index) => card.id !== drag.cards[index].id)
        ) return current;
        sourcePile.splice(drag.source.cardIndex);
        if (sourcePile.length > 0) {
          sourcePile[sourcePile.length - 1] = { ...sourcePile[sourcePile.length - 1], revealed: true };
        }
      } else if (!current.hand.some((card) => card.id === drag.card.id)) {
        return current;
      }

      nextPiles[targetPileIndex].push(...drag.cards.map((card) => ({
        ...card,
        revealed: drag.source.type === "hand" ? true : card.revealed,
      })));
      const cardLabel = drag.cards.length > 1 ? `${drag.cards.length}장` : drag.card.name;
      const action = drag.source.type === "hand"
        ? `${drag.card.name} 카드를 손패에서 ${targetPileIndex + 1}번 파일로 이동`
        : `${drag.source.pileIndex + 1}번 파일의 ${cardLabel}을(를) ${targetPileIndex + 1}번 파일로 이동`;

      return {
        ...current,
        piles: nextPiles,
        hand: drag.source.type === "hand"
          ? current.hand.filter((card) => card.id !== drag.card.id)
          : current.hand,
        stars: current.stars - 1,
        message: action,
        history: [action, ...current.history].slice(0, 5),
      };
    });
  };

  const finishDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const current = dragRef.current;
    if (!current) return;
    if (current.moved) {
      const dropZone = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-drop-target]")
        ?.dataset.dropTarget;
      const targetEnemyId = dropZone?.startsWith("enemy:") ? dropZone.slice(6) : undefined;
      const targetPileIndex = dropZone?.startsWith("pile:") ? Number(dropZone.slice(5)) : undefined;

      if (dropZone === "hand" && current.source.type === "pile") {
        setGame((state) => ({
          ...state,
          message: "★★로 파일 카드를 가져오는 기능은 현재 사용할 수 없습니다.",
        }));
        dragRef.current = null;
        setDragging(null);
        return;
      }

      if (targetPileIndex !== undefined && Number.isInteger(targetPileIndex)) {
        moveCardToPile(current, targetPileIndex);
        dragRef.current = null;
        setDragging(null);
        return;
      }

      const resolvedTargetEnemyId = targetEnemyId
        ?? (current.card.kind === "strike" && dropZone === "defend" ? lockedEnemyId ?? undefined : undefined);
      const validDrop =
        current.source.type === "hand" && (
          (current.card.kind === "strike" && Boolean(resolvedTargetEnemyId)) ||
          (current.card.effect === "ironRampage" && dropZone === "defend") ||
          (current.card.kind !== "strike" && dropZone === "defend")
        );
      if (validDrop) {
        playCard(current.card, resolvedTargetEnemyId);
      } else {
        setGame((state) => ({
          ...state,
          message: current.source.type === "pile"
            ? "앞면 카드 묶음은 다른 파일 위에 놓아주세요."
            : current.card.kind === "strike"
              ? "타격 카드는 적이나 파일 위에 놓아주세요."
              : "이 카드는 중앙 영역이나 파일 위에 놓아주세요.",
        }));
      }
    }
    dragRef.current = null;
    setDragging(null);
  };

  const cancelDrag = () => {
    dragRef.current = null;
    setDragging(null);
  };

  const toggleLock = (enemy: EnemyState) => {
    if (
      phase !== "playing" ||
      game.pendingDraws > 0 ||
      game.pendingDiscards > 0 ||
      game.pendingSweep ||
      enemy.hp === 0
    ) return;
    setLockedEnemyId((current) => current === enemy.id ? null : enemy.id);
  };

  const endTurn = () => {
    if (
      game.status !== "playing" ||
      game.pendingDraws > 0 ||
      game.pendingDiscards > 0 ||
      game.pendingSweep ||
      phase !== "playing"
    ) return;
    setPhase("discarding");
    setDragging(null);

    const discardDelay = 340 + Math.max(0, game.hand.length - 1) * 42;
    later(() => {
      const livingEnemies = game.enemies.filter((enemy) => enemy.hp > 0);
      const discarded = [...game.discard, ...game.hand];
      let remainingPhysicalBlock = game.playerPhysicalBlock;
      let remainingMagicBlock = game.playerMagicBlock;
      let remainingHp = game.playerHp;
      const steps: Array<{
        enemy: EnemyState;
        attack: EnemyAttack;
        damage: number;
        hpAfter: number;
        physicalBlockAfter: number;
        magicBlockAfter: number;
      }> = [];

      for (const enemy of livingEnemies) {
        if (remainingHp === 0) break;
        const attack = enemy.awakened ? enemy.awakenedAttack : enemy.pattern[enemy.intentIndex];
        const matchingBlock = attack.type === "physical" ? remainingPhysicalBlock : remainingMagicBlock;
        const blocked = game.invulnerable ? 0 : Math.min(attack.value, matchingBlock);
        const damage = game.invulnerable ? 0 : (attack.value - blocked) * game.damageTakenMultiplier;
        if (!game.invulnerable && attack.type === "physical") remainingPhysicalBlock -= blocked;
        else if (!game.invulnerable) remainingMagicBlock -= blocked;
        remainingHp = Math.max(0, remainingHp - damage);
        steps.push({
          enemy,
          attack,
          damage,
          hpAfter: remainingHp,
          physicalBlockAfter: remainingPhysicalBlock,
          magicBlockAfter: remainingMagicBlock,
        });
      }

      const nextEnemies = game.enemies.map((enemy) => {
        if (enemy.hp === 0 || !steps.some((step) => step.enemy.id === enemy.id)) return enemy;
        if (enemy.awakened) {
          return { ...enemy, passion: 0, awakened: false };
        }
        const nextPassion = Math.min(3, enemy.passion + 1);
        return {
          ...enemy,
          passion: nextPassion,
          awakened: nextPassion === 3,
          intentIndex: (enemy.intentIndex + 1) % enemy.pattern.length,
        };
      });

      setGame({
        ...game,
        hand: [],
        discard: discarded,
        message: "적들이 움직이기 시작합니다.",
      });
      setPhase("enemy-turn");

      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const stepDuration = reducedMotion ? 160 : 820;
      const hitAt = reducedMotion ? 40 : 390;
      const clearAt = reducedMotion ? 100 : 720;

      steps.forEach((step, index) => {
        const base = index * stepDuration;
        later(() => setAttackingEnemyId(step.enemy.id), base);
        later(() => {
          setDamagePopup({
            key: `${step.enemy.id}-${Date.now()}`,
            text: step.damage > 0 ? `-${step.damage}` : "막음",
          });
          setGame((current) => ({
            ...current,
            playerHp: step.hpAfter,
            playerPhysicalBlock: step.physicalBlockAfter,
            playerMagicBlock: step.magicBlockAfter,
            message: step.damage > 0
              ? `${step.enemy.name}의 ${ATTACK_LABEL[step.attack.type]} — ${step.damage} 피해`
              : `${step.enemy.name}의 ${ATTACK_LABEL[step.attack.type]}을 막았습니다.`,
          }));
        }, base + hitAt);
        later(() => setAttackingEnemyId(null), base + clearAt);
      });

      later(() => {
        setDamagePopup(null);
        setAttackingEnemyId(null);
        const attackHistory = steps.map((step) =>
          `${step.enemy.name}${step.enemy.awakened ? " 각성" : ""}: ${ATTACK_LABEL[step.attack.type]} ${step.attack.value} · ${step.damage} 피해`);

        if (remainingHp === 0) {
          setGame({
            ...game,
            hand: [],
            discard: discarded,
            playerHp: 0,
            playerPhysicalBlock: remainingPhysicalBlock,
            playerMagicBlock: remainingMagicBlock,
            enemies: nextEnemies,
            status: "lost",
            message: "적의 공격을 받고 쓰러졌습니다.",
            history: [...attackHistory, ...game.history].slice(0, 5),
          });
          setPhase("playing");
          return;
        }

        const allPilesEmpty = game.piles.every((pile) => pile.length === 0);
        const sourcePiles = allPilesEmpty ? buildPiles(shuffle(discarded)) : game.piles;
        setGame({
          ...game,
          piles: sourcePiles,
          hand: [],
          discard: allPilesEmpty ? [] : discarded,
          energy: 3,
          turn: game.turn + 1,
          playerHp: remainingHp,
          playerPhysicalBlock: 0,
          playerMagicBlock: 0,
          defenseMultiplier: 1,
          damageTakenMultiplier: 1,
          invulnerable: false,
          enemies: nextEnemies,
          message: allPilesEmpty ? "전체 덱을 다시 섞었습니다." : "적의 턴이 끝났습니다.",
          history: [...attackHistory, ...game.history].slice(0, 5),
        });
        setPhase("drawing");
        later(drawCards, allPilesEmpty ? 330 : 120);
      }, steps.length * stepDuration + 80);
    }, discardDelay);
  };

  const controlsLocked =
    phase !== "playing" ||
    game.status !== "playing" ||
    game.pendingDraws > 0 ||
    game.pendingDiscards > 0 ||
    game.pendingSweep;

  if (screen === "map") {
    const exploredCount = visitedRooms.size;
    const currentRoomKey = mapRoomKey(mapPosition);
    const canEditDeck = getRoomType(mapPosition, mapSeed) === "empty" || clearedCombats.has(currentRoomKey);
    const deckGroups = Array.from(deckCards.reduce((groups, card) => {
      const groupKey = `${card.effect}:${card.damageType}:${card.name}`;
      const current = groups.get(groupKey);
      if (current) current.cardIds.push(card.id);
      else groups.set(groupKey, { card, cardIds: [card.id] });
      return groups;
    }, new Map<string, { card: Card; cardIds: number[] }>()).values()).sort((left, right) =>
      left.card.cost - right.card.cost || left.card.name.localeCompare(right.card.name, "ko"));
    const inventoryGroups = Array.from(inventoryCards.reduce((groups, card) => {
      const groupKey = `${card.effect}:${card.damageType}:${card.name}`;
      const current = groups.get(groupKey);
      if (current) current.cardIds.push(card.id);
      else groups.set(groupKey, { card, cardIds: [card.id] });
      return groups;
    }, new Map<string, { card: Card; cardIds: number[] }>()).values()).sort((left, right) =>
      left.card.cost - right.card.cost || left.card.name.localeCompare(right.card.name, "ko"));
    const currentFloorCards = roomDrops[currentRoomKey] ?? [];
    const floorGroups = Array.from(currentFloorCards.reduce((groups, card) => {
      const groupKey = `${card.effect}:${card.damageType}:${card.name}`;
      const current = groups.get(groupKey);
      if (current) current.cardIds.push(card.id);
      else groups.set(groupKey, { card, cardIds: [card.id] });
      return groups;
    }, new Map<string, { card: Card; cardIds: number[] }>()).values()).sort((left, right) =>
      left.card.cost - right.card.cost || left.card.name.localeCompare(right.card.name, "ko"));
    const mapWidth = MAP_PADDING * 2 + MAP_COLUMNS * MAP_ROOM_WIDTH + (MAP_COLUMNS - 1) * MAP_CELL_GAP;
    const mapHeight = MAP_PADDING * 2 + MAP_ROWS * MAP_ROOM_HEIGHT + (MAP_ROWS - 1) * MAP_CELL_GAP;

    return (
      <main className="game-shell map-shell">
        <header className="topbar map-topbar">
          <div>
            <p className="eyebrow">THE DESCENT · EXPLORATION MAP</p>
            <h1>아래로 이어지는 방</h1>
          </div>
          <div className="map-top-actions">
            <div className="map-run-stats">
              <div className="map-health" aria-label={`체력 ${runPlayerHp} 중 ${MAX_PLAYER_HP}`}>
                <span>HP</span><strong>{runPlayerHp} / {MAX_PLAYER_HP}</strong>
              </div>
              <div><span>깊이</span><strong>{mapPosition.y}</strong></div>
              <div><span>방문</span><strong>{exploredCount}</strong></div>
            </div>
            {canEditDeck && (
              <button
                type="button"
                className="deck-editor-trigger"
                onClick={() => openDeckEditor("인벤토리 카드는 덱에 넣거나 바닥에 둘 수 있고, 덱 카드는 우클릭으로 제거합니다.")}
                aria-label={`덱 편집, 현재 ${deckCards.length}장`}
              >
                <span className="deck-stack-icon" aria-hidden="true" />
                <span>덱 편집</span>
              </button>
            )}
          </div>
        </header>

        <section className="map-board" aria-label="탐험 지도">
          <div className="map-toolbar">
            <div className="map-legend" aria-label="지도 범례">
              <span><i className="legend-current" />현재 위치</span>
              <span><i className="legend-empty" />빈 방</span>
              <span><i className="legend-combat" />전투</span>
              <span><i className="legend-cleared" />클리어</span>
              <span><i className="legend-unknown" />미방문</span>
            </div>
            <div className="map-toolbar-actions">
              <span className="map-help">인접한 방을 클릭해 이동 · 드래그로 탐색 · 휠로 확대/축소</span>
              <span className="map-zoom-value" aria-label={`지도 배율 ${Math.round(mapZoom * 100)}퍼센트`}>
                {Math.round(mapZoom * 100)}%
              </span>
              <button type="button" className="recenter-map" onClick={() => centerMapOn(mapPosition)}>
                현재 위치로
              </button>
            </div>
          </div>

          <div
            className="map-viewport"
            ref={mapViewportRef}
            onPointerDown={beginMapDrag}
            onPointerMove={moveMapDrag}
            onPointerUp={finishMapDrag}
            onPointerCancel={finishMapDrag}
            onPointerLeave={finishMapDrag}
            onWheel={zoomMap}
          >
            <div
              className="map-canvas"
              style={{
                width: mapWidth,
                height: mapHeight,
                padding: MAP_PADDING,
                gap: MAP_CELL_GAP,
                gridTemplateColumns: `repeat(${MAP_COLUMNS}, ${MAP_ROOM_WIDTH}px)`,
                gridAutoRows: `${MAP_ROOM_HEIGHT}px`,
                transform: `translate3d(${mapPan.x}px, ${mapPan.y}px, 0) scale(${mapZoom})`,
                transformOrigin: "0 0",
              }}
            >
              {Array.from({ length: MAP_COLUMNS * MAP_ROWS }, (_, index) => {
                const position = { x: index % MAP_COLUMNS, y: Math.floor(index / MAP_COLUMNS) };
                const roomKey = mapRoomKey(position);
                const visited = visitedRooms.has(roomKey);
                const cleared = clearedCombats.has(roomKey);
                const roomType = getRoomType(position, mapSeed);
                const current = position.x === mapPosition.x && position.y === mapPosition.y;
                const distance = Math.abs(position.x - mapPosition.x) + Math.abs(position.y - mapPosition.y);
                const adjacent = distance === 1;
                const roomState = !visited
                  ? "unknown"
                  : cleared
                    ? "cleared"
                    : roomType;
                const roomLabel = current
                  ? "현재 위치"
                  : !visited
                    ? "미지의 방"
                    : cleared
                      ? "클리어한 전투 방"
                      : roomType === "combat"
                        ? "전투 방"
                        : "빈 방";
                return (
                  <button
                    type="button"
                    className={`map-room is-${roomState} ${current ? "is-current" : ""} ${adjacent ? "is-adjacent" : ""}`}
                    key={roomKey}
                    tabIndex={adjacent ? 0 : -1}
                    aria-disabled={!adjacent}
                    aria-label={`${roomLabel}, 좌표 ${position.x + 1}, 깊이 ${position.y}`}
                    onClick={() => {
                      if (mapWasDraggedRef.current) {
                        mapWasDraggedRef.current = false;
                        return;
                      }
                      if (!adjacent) return;
                      moveOnMap(position.x - mapPosition.x, position.y - mapPosition.y);
                    }}
                  >
                    {current
                      ? <span className="map-player">P</span>
                      : visited
                        ? <span>{cleared ? "정리" : roomType === "combat" ? "전투" : "빈 방"}</span>
                        : null}
                  </button>
                );
              })}
            </div>
            <div className="map-depth-fade" aria-hidden="true" />
          </div>
          {currentFloorCards.length > 0 && canEditDeck && (
            <button
              type="button"
              className="room-floor-notice"
              onClick={() => openDeckEditor("바닥 카드를 인벤토리로 드래그하거나 클릭해 주울 수 있습니다.")}
            >
              <span>방 바닥</span>
              <strong>카드 {currentFloorCards.length}장</strong>
              <small>눌러서 확인</small>
            </button>
          )}
        </section>

        {deckEditorOpen && (
          <div className="deck-editor-overlay" role="dialog" aria-modal="true" aria-labelledby="deck-editor-title" onClick={cancelDeckEditor}>
            <section className="deck-editor-panel" onClick={(event) => event.stopPropagation()}>
              <header className="deck-editor-header">
                <div>
                  <p>LOADOUT</p>
                  <h2 id="deck-editor-title">덱 편집</h2>
                  <span>인벤토리 카드는 자유롭게 덱에 넣을 수 있습니다. 덱 카드는 우클릭하여 영구 제거합니다. 인벤토리가 {INVENTORY_CAPACITY}장을 넘으면 편집을 확인할 수 없습니다.</span>
                </div>
                <div className="deck-editor-header-actions">
                  <button type="button" className="cancel" onClick={cancelDeckEditor}>취소</button>
                  <button
                    type="button"
                    className="confirm"
                    onClick={confirmDeckEditor}
                    disabled={inventoryCards.length > INVENTORY_CAPACITY}
                  >편집 확인</button>
                </div>
              </header>

              <div className="deck-editor-columns">
                <section
                  className={`deck-editor-column inventory-column ${deckEditorDropTarget === "inventory" ? "is-drop-target" : ""}`}
                  onDragOver={(event) => {
                    if (deckEditorDrag?.source !== "floor") return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDeckEditorDropTarget("inventory");
                  }}
                  onDrop={(event) => dropDeckEditorCard(event, "inventory")}
                >
                  <div className="deck-editor-column-title">
                    <h3>인벤토리</h3>
                    <strong className={inventoryCards.length > INVENTORY_CAPACITY ? "is-full" : ""}>
                      {inventoryCards.length} / {INVENTORY_CAPACITY}
                    </strong>
                  </div>
                  <div className="deck-editor-card-list">
                    {inventoryGroups.map(({ card, cardIds }) => (
                      <button
                        type="button"
                        className={`deck-editor-card card-face ${card.kind} ${card.damageType} ${deckEditorDrag?.cardId === cardIds.at(-1) ? "is-dragging" : ""}`}
                        key={`${card.effect}:${card.damageType}:${card.name}`}
                        draggable
                        onDragStart={(event) => beginDeckEditorDrag(event, cardIds.at(-1)!, "inventory")}
                        onDragEnd={finishDeckEditorDrag}
                        onClick={() => moveInventoryCardToDeck(cardIds.at(-1)!)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          moveInventoryCardToFloor(cardIds.at(-1)!);
                        }}
                        aria-label={`${card.name} ${cardIds.length}장, 좌클릭하면 덱으로 이동, 우클릭하면 바닥으로 이동`}
                      >
                        <CardFace card={card} />
                        {cardIds.length > 1 && <span className="inventory-card-count">x{cardIds.length}</span>}
                      </button>
                    ))}
                    {inventoryCards.length === 0 && (
                      <div className="deck-editor-empty">바닥의 카드를 줍거나 보상 카드를 획득하면 이곳에 보관됩니다.</div>
                    )}
                  </div>
                </section>

                <section
                  className={`deck-editor-column deck-list-column ${deckEditorDropTarget === "deck" ? "is-drop-target" : ""}`}
                  onDragOver={(event) => {
                    if (deckEditorDrag?.source !== "inventory" || deckCards.length >= STARTER_DECK_CASE.capacity) {
                      event.dataTransfer.dropEffect = "none";
                      setDeckEditorDropTarget(null);
                      return;
                    }
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDeckEditorDropTarget("deck");
                  }}
                  onDrop={(event) => dropDeckEditorCard(event, "deck")}
                >
                  <div className="deck-editor-column-title">
                    <h3>{STARTER_DECK_CASE.name}</h3>
                    <strong className={deckCards.length >= STARTER_DECK_CASE.capacity ? "is-full" : ""}>
                      {deckCards.length} / {STARTER_DECK_CASE.capacity}
                    </strong>
                  </div>
                  <div className="deck-editor-deck-body">
                    <div className="deck-editor-deck-list">
                      {deckGroups.map(({ card, cardIds }) => (
                        <button
                          type="button"
                          className={`deck-list-entry rarity-${card.rarity}`}
                          key={`${card.effect}:${card.damageType}:${card.name}`}
                          onMouseEnter={() => setHoveredDeckCard(card)}
                          onMouseLeave={() => setHoveredDeckCard(null)}
                          onFocus={() => setHoveredDeckCard(card)}
                          onBlur={() => setHoveredDeckCard(null)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            removeDeckCard(cardIds.at(-1)!);
                          }}
                          aria-label={`${card.name} ${cardIds.length}장, 우클릭하면 한 장을 영구 제거`}
                        >
                          <span className="deck-list-cost">{card.cost}</span>
                          <strong>{card.name}</strong>
                          <span className="deck-list-count">x{cardIds.length}</span>
                        </button>
                      ))}
                    </div>
                    <aside className="deck-card-preview" aria-live="polite">
                      <strong>카드 미리보기</strong>
                      {hoveredDeckCard ? (
                        <div className={`card-face ${hoveredDeckCard.kind} ${hoveredDeckCard.damageType}`}>
                          <CardFace card={hoveredDeckCard} />
                        </div>
                      ) : (
                        <span>덱 카드에 마우스를 올리세요.</span>
                      )}
                    </aside>
                  </div>
                </section>
              </div>

              <section className="deck-editor-floor-section">
                <div className="deck-editor-floor-heading">
                  <div><strong>방 바닥</strong><span>{currentFloorCards.length}장</span></div>
                  {pendingRemovedCards.length > 0 ? (
                    <strong className="removal-warning">
                      경고: 편집 확인 시 카드 {pendingRemovedCards.length}장이 영구 제거됩니다. 카드를 누르면 취소됩니다.
                    </strong>
                  ) : (
                    <small>인벤토리 카드를 이곳에 놓을 수 있으며, 방을 떠나도 카드 상태는 변하지 않습니다.</small>
                  )}
                </div>
                <div className="deck-editor-floor-layout">
                  <div
                    className={`deck-editor-floor-cards ${deckEditorDropTarget === "floor" ? "is-drop-target" : ""}`}
                    onDragOver={(event) => {
                      if (deckEditorDrag?.source !== "inventory") return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDeckEditorDropTarget("floor");
                    }}
                    onDrop={(event) => dropDeckEditorCard(event, "floor")}
                  >
                    {pendingRemovedCards.map((card) => (
                      <button
                        type="button"
                        className={`deck-editor-card pending-removal-card card-face ${card.kind} ${card.damageType}`}
                        key={`pending-removal-${card.id}`}
                        onClick={() => restoreRemovedCard(card.id)}
                        aria-label={`${card.name}, 제거 예정. 누르면 덱으로 복구`}
                      >
                        <CardFace card={card} />
                        <span className="pending-removal-badge">제거 예정</span>
                      </button>
                    ))}
                    {floorGroups.map(({ card, cardIds }) => (
                      <button
                        type="button"
                        className={`deck-editor-card card-face ${card.kind} ${card.damageType} ${deckEditorDrag?.cardId === cardIds.at(-1) ? "is-dragging" : ""}`}
                        key={`${card.effect}:${card.damageType}:${card.name}`}
                        draggable
                        onDragStart={(event) => beginDeckEditorDrag(event, cardIds.at(-1)!, "floor")}
                        onDragEnd={finishDeckEditorDrag}
                        onClick={() => moveFloorCardToInventory(cardIds.at(-1)!)}
                        aria-label={`${card.name} ${cardIds.length}장, 한 장을 인벤토리에 줍기`}
                      >
                        <CardFace card={card} />
                        {cardIds.length > 1 && <span className="inventory-card-count">x{cardIds.length}</span>}
                      </button>
                    ))}
                    {currentFloorCards.length === 0 && pendingRemovedCards.length === 0 && (
                      <span className="floor-empty-copy">바닥에 카드가 없습니다</span>
                    )}
                  </div>
                </div>
              </section>

              <footer className="deck-editor-footer">
                <span role="status" aria-live="polite">{deckEditorMessage}</span>
              </footer>
            </section>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="game-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">SOLITAIRE DECKBATTLE · PROTOTYPE</p>
          <h1>카드 파일 전투</h1>
        </div>
        <div className="turn-badge" aria-label={`현재 ${game.turn}턴`}>
          <span>TURN</span><strong>{game.turn}</strong>
        </div>
      </header>

      <section
        className={`battlefield ${dragging ? `${dragging.source.type === "hand" ? `dragging-${dragging.card.kind}` : "dragging-from-pile"} dragging-solitaire` : ""} ${lockedEnemyId ? "has-lock" : ""}`}
        aria-label="전투 화면"
      >
        <div className="enemy-zone">
          <div className="enemies-row">
            {game.enemies.map((enemy) => {
              const defeated = enemy.hp === 0;
              const intent = enemy.awakened ? enemy.awakenedAttack : enemy.pattern[enemy.intentIndex];
              return (
                <button
                  type="button"
                  className={`enemy-unit ${enemy.variant} ${defeated ? "is-defeated" : ""} ${enemy.awakened ? "is-awakened" : ""} ${lockedEnemyId === enemy.id ? "is-locked" : ""} ${attackingEnemyId === enemy.id ? "is-attacking" : ""}`}
                  data-drop-target={defeated ? undefined : `enemy:${enemy.id}`}
                  key={enemy.id}
                  onClick={() => toggleLock(enemy)}
                  disabled={defeated}
                  aria-pressed={lockedEnemyId === enemy.id}
                  aria-label={`${enemy.name}${defeated ? ", 격파됨" : lockedEnemyId === enemy.id ? ", 록온됨" : ", 클릭하여 록온"}`}
                >
                  {lockedEnemyId === enemy.id && <span className="lock-badge">LOCK ON</span>}
                  {!defeated && <div className="drop-prompt attack-prompt">이 적을 공격</div>}
                  <div className={`intent ${defeated ? "is-defeated" : intent.type}`}>
                    <span>{defeated ? "상태" : enemy.awakened ? "각성 공격" : "다음 행동"}</span>
                    {defeated ? (
                      <strong>격파</strong>
                    ) : (
                      <div
                        className={`attack-symbol ${intent.type}`}
                        aria-label={`${ATTACK_LABEL[intent.type]} ${intent.value}`}
                      >
                        <div className="intent-symbol-core"><strong>{intent.value}</strong></div>
                        <i className="intent-symbol-detail" />
                        <i className="intent-symbol-handle" />
                      </div>
                    )}
                  </div>
                  <div className="monster" aria-label={enemy.name}>
                    <div className="monster-horns"><i /><i /></div>
                    <div className="monster-face"><b /><b /><span /></div>
                  </div>
                  {!defeated && (
                    <div
                      className={`enemy-passion ${enemy.awakened ? "is-awakened" : ""}`}
                      aria-label={enemy.awakened ? "열정이 가득 차 각성함" : `열정 ${enemy.passion}개`}
                    >
                      {Array.from({ length: enemy.passion }, (_, index) => <span key={index}>🔥</span>)}
                    </div>
                  )}
                  <div className="unit-stats enemy-stats">
                    <strong>{enemy.name}</strong>
                    <div className="healthbar enemy-health">
                      <i style={{ width: `${(enemy.hp / enemy.maxHp) * 100}%` }} />
                      <span>{enemy.hp} / {enemy.maxHp}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="pile-zone">
          <div className="section-label">
            <span>{game.pendingSweep ? "가져올 파일 선택" : game.pendingDraws > 0 ? "드로우할 파일 선택" : "파일"}</span>
            <small>{game.pendingSweep
              ? "원하는 파일을 클릭해 모든 카드를 손으로 가져오세요"
              : game.pendingDraws > 0
                ? "원하는 파일을 클릭해 맨 위 카드를 가져오세요"
                : "각 파일의 맨 위 카드를 턴 시작에 가져옵니다"}</small>
          </div>
          <div className="piles" aria-label="카드 파일들">
            {game.piles.map((pile, index) => {
              const stackOffset = getStackOffset(pile.length);
              return (
                <div
                  className={`solitaire-pile ${game.pendingDraws > 0 || game.pendingSweep ? pile.length > 0 ? "is-draw-choice" : "is-draw-empty" : ""}`}
                  key={index}
                  data-pile-index={index}
                  data-drop-target={`pile:${index}`}
                  aria-label={`${index + 1}번 파일, ${pile.length}장`}
                  onClick={() => game.pendingSweep ? takeSelectedPile(index) : drawSelectedPile(index)}
                >
                {pile.length === 0 && <div className="empty-slot" aria-hidden="true" />}
                {pile.map((card, cardIndex) => {
                  const isTop = cardIndex === pile.length - 1;
                  const faceUp = card.revealed;
                  const isMoving = dragging?.source.type === "pile"
                    && dragging.source.pileIndex === index
                    && cardIndex >= dragging.source.cardIndex;
                  return (
                    <div
                      className={`stacked-card ${faceUp ? `card-face face-up pile-draggable-card ${card.kind} ${card.damageType}` : "face-down"} ${isMoving ? "is-dragging" : ""}`}
                      style={{
                        top: `${cardIndex * stackOffset}px`,
                        "--stack-index": cardIndex,
                      } as CSSProperties}
                      key={card.id}
                      data-card-id={card.id}
                      data-top-card-id={isTop ? card.id : undefined}
                      aria-hidden={!faceUp}
                      role={faceUp ? "button" : undefined}
                      tabIndex={faceUp ? 0 : undefined}
                      onPointerDown={faceUp ? (event) => beginDrag(
                        event,
                        card,
                        { type: "pile", pileIndex: index, cardIndex },
                        pile.slice(cardIndex),
                      ) : undefined}
                      onPointerMove={faceUp ? moveDrag : undefined}
                      onPointerUp={faceUp ? finishDrag : undefined}
                      onPointerCancel={faceUp ? cancelDrag : undefined}
                    >
                      {faceUp ? <CardFace card={card} /> : <span className="card-back-pattern" />}
                    </div>
                  );
                })}
                </div>
              );
            })}
          </div>
        </div>

        <div className="center-drop-zone" data-drop-target="defend">
          <div className="drop-prompt defend-prompt">
            {dragging?.card.kind === "strike" && dragging.card.effect !== "ironRampage" && lockedEnemyId
              ? `록온 공격: ${game.enemies.find((enemy) => enemy.id === lockedEnemyId)?.name}`
              : dragging?.card.effect === "ironRampage"
                ? "여기에 놓아 전체 공격"
              : dragging?.card.kind === "defend"
                ? `여기에 놓아 ${DEFENSE_LABEL[dragging.card.damageType]}`
                : dragging?.card.kind === "skill"
                  ? "여기에 놓아 사용"
                  : "여기에 놓아 수비"}
          </div>
          <div className="defense-shields" aria-label="현재 방어도">
            <div className="defense-shield physical" aria-label={`방어 ${game.playerPhysicalBlock}`}>
              <span>방어</span>
              <strong>{game.playerPhysicalBlock}</strong>
            </div>
            <div className="defense-shield magic" aria-label={`마법 방어 ${game.playerMagicBlock}`}>
              <span>마법 방어</span>
              <strong>{game.playerMagicBlock}</strong>
            </div>
          </div>
          <div className="combat-buffs" aria-label="현재 강화 효과">
            <span>힘 {game.strength}</span>
            {game.defenseMultiplier > 1 && <span>방어 ×{game.defenseMultiplier}</span>}
            {game.damageTakenMultiplier > 1 && <span>받는 피해 ×{game.damageTakenMultiplier}</span>}
            {game.invulnerable && <span>피해 면역</span>}
            {game.doubleNextAttack && <span>다음 공격 2회</span>}
          </div>
          <div className="status-strip" role="status" aria-live="polite">{game.message}</div>
        </div>

        <div className="player-zone">
          {damagePopup && (
            <div className={`damage-popup ${damagePopup.text === "막음" ? "is-blocked" : ""}`} key={damagePopup.key}>
              {damagePopup.text}
            </div>
          )}
          <div className="player-panel">
            <div className="player-avatar">P</div>
            <div className="player-details">
              <strong>방랑자</strong>
              <div className="healthbar player-health">
                <i style={{ width: `${(game.playerHp / MAX_PLAYER_HP) * 100}%` }} />
                <span>{game.playerHp} / {MAX_PLAYER_HP}</span>
              </div>
            </div>
          </div>

          <div
            className={`hand ${phase === "discarding" ? "is-discarding" : ""} ${game.pendingDiscards > 0 ? "is-discard-choice" : ""}`}
            data-drop-target="hand"
            aria-label="손패"
          >
            {game.hand.map((card, index) => (
              <button
                className={`game-card card-face ${card.kind} ${card.damageType} ${dragging?.card.id === card.id ? "is-dragging" : ""}`}
                key={card.id}
                ref={(element) => {
                  if (element) handCardRefs.current.set(card.id, element);
                  else handCardRefs.current.delete(card.id);
                }}
                style={{ "--card-index": index } as CSSProperties}
                onPointerDown={(event) => beginDrag(event, card, { type: "hand" })}
                onPointerMove={moveDrag}
                onPointerUp={finishDrag}
                onPointerCancel={cancelDrag}
                onClick={() => game.pendingDiscards > 0 && discardSelectedCard(card.id)}
                disabled={controlsLocked && game.pendingDiscards === 0}
                aria-label={`${card.name}, 에너지 ${card.cost}`}
              >
                <CardFace card={card} />
              </button>
            ))}
            {game.hand.length === 0 && phase === "playing" && game.status === "playing" && (
              <div className="empty-hand">사용할 카드가 없습니다</div>
            )}
          </div>

          <div className="controls">
            {game.stars > 0 && (
              <div
                className="solitaire-resource"
                aria-label={`솔리테어 행동 자원 ${game.stars}개 남음`}
                title="솔리테어 행동 자원"
              >
                {Array.from({ length: game.stars }, (_, slot) => <span key={slot}>★</span>)}
              </div>
            )}
            <div className="energy-orb" aria-label={`에너지 ${game.energy} 중 3`}>
              <span>{game.energy}</span><small>/ 3</small>
            </div>
            <button className="end-turn" onClick={endTurn} disabled={controlsLocked}>
              턴 종료 <span>→</span>
            </button>
          </div>
        </div>

        {game.status !== "playing" && (
          <div className="result-overlay" role="dialog" aria-modal="true" aria-labelledby="result-title">
            <div className={`result-card ${game.status === "won" ? "has-rewards" : ""}`}>
              <p>{game.status === "won" ? "BATTLE CLEARED" : "RUN ENDED"}</p>
              <h2 id="result-title">{game.status === "won" ? "승리" : "패배"}</h2>
              <span>{game.status === "won"
                ? `${game.playerHp} 체력으로 전투를 마쳤습니다.`
                : `${game.turn}턴에서 탐험이 끝났습니다.`}</span>
              {game.status === "won" && (
                <div className="battle-reward-section">
                  <strong>전투 보상</strong>
                  <small>두 카드가 이 방 바닥에 떨어집니다</small>
                  <div className="battle-reward-cards">
                    {battleRewards.map((card) => (
                      <div
                        className={`battle-reward-card card-face ${card.kind} ${card.damageType}`}
                        key={card.id}
                      >
                        <CardFace card={card} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <button
                onClick={game.status === "won" ? returnToMap : startNewRun}
                disabled={game.status === "won" && battleRewards.length < 2}
              >
                {game.status === "won" ? "다음" : "새 탐험 시작"}
              </button>
            </div>
          </div>
        )}

        {dragging?.moved && (
          <div
            className="drag-stack-preview"
            style={{
              left: dragging.x,
              top: dragging.y,
              height: `${CARD_HEIGHT + Math.max(0, dragging.cards.length - 1) * getStackOffset(dragging.cards.length)}px`,
            }}
            aria-hidden="true"
          >
            {dragging.cards.map((card, index) => (
              <div
                className={`drag-card-preview card-face ${card.kind} ${card.damageType}`}
                style={{ top: `${index * getStackOffset(dragging.cards.length)}px` }}
                key={card.id}
              >
                <CardFace card={card} />
              </div>
            ))}
          </div>
        )}
      </section>

      <aside className="combat-log" aria-label="최근 전투 기록">
        <strong>전투 기록</strong>
        {game.history.map((entry, index) => <span key={`${entry}-${index}`}>{entry}</span>)}
      </aside>
    </main>
  );
}
