// ── Web3 state ───────────────────────────────────────────────────────────────
let provider         = null;
let signer           = null;
let contract         = null;
let readonlyContract = null;
let CONTRACT_ADDRESS = null;
let CONTRACT_ABI     = null;

// ── App state ────────────────────────────────────────────────────────────────
const encoder = new TextEncoder();
const state = {
  records:         [],
  ledger:          [],
  version:         0n,
  node:            getOrCreateNode(),
  sessionId:       makeId("session"),
  canvasPulse:     0,
  walletConnected: false
};

const channel = "BroadcastChannel" in window
  ? new BroadcastChannel("blockshare-sync") : null;

// ── DOM refs ─────────────────────────────────────────────────────────────────
const els = {
  walletOverlay:     document.querySelector("#walletOverlay"),
  overlayConnectBtn: document.querySelector("#overlayConnectBtn"),
  overlayStatus:     document.querySelector("#overlayStatus"),
  sidebarConnectBtn: document.querySelector("#sidebarConnectBtn"),
  walletDot:         document.querySelector("#walletDot"),
  nodeName:          document.querySelector("#nodeName"),
  syncStatus:        document.querySelector("#syncStatus"),
  shareCount:        document.querySelector("#shareCount"),
  blockCount:        document.querySelector("#blockCount"),
  chainStatus:       document.querySelector("#chainStatus"),
  draftStatus:       document.querySelector("#draftStatus"),
  typingBadge:       document.querySelector("#typingBadge"),
  shareForm:         document.querySelector("#shareForm"),
  dataTitle:         document.querySelector("#dataTitle"),
  receiverAddress:   document.querySelector("#receiverAddress"),
  classification:    document.querySelector("#classification"),
  passphrase:        document.querySelector("#passphrase"),
  liveInput:         document.querySelector("#liveInput"),
  charCount:         document.querySelector("#charCount"),
  lastInputAt:       document.querySelector("#lastInputAt"),
  livePreview:       document.querySelector("#livePreview"),
  loadSampleBtn:     document.querySelector("#loadSampleBtn"),
  verifyChainBtn:    document.querySelector("#verifyChainBtn"),
  resetDemoBtn:      document.querySelector("#resetDemoBtn"),
  eventPulse:        document.querySelector("#eventPulse"),
  dbVersion:         document.querySelector("#dbVersion"),
  latestHash:        document.querySelector("#latestHash"),
  recordList:        document.querySelector("#recordList"),
  ledgerList:        document.querySelector("#ledgerList"),
  toast:             document.querySelector("#toast"),
  canvas:            document.querySelector("#networkCanvas"),
  contractAddr:      document.querySelector("#contractAddr")
};

const ctx = els.canvas.getContext("2d");

// ── Particles ────────────────────────────────────────────────────────────────
const particles = Array.from({ length: 32 }, (_, i) => ({
  angle:  (Math.PI * 2 * i) / 32,
  speed:  0.003 + (i % 5) * 0.0009,
  radius: 74 + (i % 6) * 22,
  color:  i % 3 === 0 ? "#8be0bc" : i % 3 === 1 ? "#6ea8fe" : "#f5c15c"
}));

// ════════════════════════════════════════════════════════════════════════════
// BOOT
// ════════════════════════════════════════════════════════════════════════════
async function init() {
  renderCanvas();
  els.nodeName.textContent   = state.node.name;
  els.syncStatus.textContent = "Connect wallet to begin";
  await loadDeploymentArtifacts();
  bindStaticEvents();
  if (window.ethereum?.selectedAddress) await connectWallet(true);
}

async function loadDeploymentArtifacts() {
  try {
    const [depRes, abiRes] = await Promise.all([
      fetch("./deployment.json"),
      fetch("./abi.json")
    ]);
    if (!depRes.ok || !abiRes.ok) throw new Error("Files not found");
    const dep        = await depRes.json();
    CONTRACT_ADDRESS = dep.address;
    CONTRACT_ABI     = await abiRes.json();
    els.contractAddr.textContent = shortAddr(CONTRACT_ADDRESS);
    setOverlayStatus(`Contract at ${shortAddr(CONTRACT_ADDRESS)} on ${dep.network}`, false);
  } catch {
    setOverlayStatus("⚠ Run deploy script first: npm run deploy:local", true);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// WALLET
// ════════════════════════════════════════════════════════════════════════════
async function connectWallet(silent = false) {
  if (!window.ethereum) {
    showToast("MetaMask not detected. Install it first.");
    setOverlayStatus("⚠ MetaMask not detected", true);
    return;
  }
  if (!CONTRACT_ADDRESS || !CONTRACT_ABI) {
    showToast("Contract not deployed. Run: npm run deploy:local");
    return;
  }
  try {
    setOverlayStatus("Connecting…", false);
    provider = new ethers.BrowserProvider(window.ethereum);
    if (!silent) await provider.send("eth_requestAccounts", []);
    signer  = await provider.getSigner();
    const address = await signer.getAddress();
    contract         = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
    readonlyContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
    state.walletConnected  = true;
    state.node.address     = address;
    els.nodeName.textContent          = state.node.name;
    els.syncStatus.textContent        = shortAddr(address);
    els.walletDot.style.background    = "#8be0bc";
    els.walletDot.style.boxShadow     = "0 0 0 6px rgba(139,224,188,0.14)";
    els.sidebarConnectBtn.textContent = "Wallet connected ✓";
    els.sidebarConnectBtn.disabled    = true;
    els.walletOverlay.classList.add("hidden");
    await loadState();
    setupContractListeners();
    setupBroadcastChannel();
    render();
    await verifyChain(false);
    showToast("Wallet connected — ready to transact on-chain.");
    window.ethereum.on("accountsChanged", () => location.reload());
    window.ethereum.on("chainChanged",    () => location.reload());
  } catch (err) {
    if (!silent) showToast(err.message || "Wallet connection failed.");
    setOverlayStatus("Connection failed. Try again.", true);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CONTRACT: LOAD STATE
// ════════════════════════════════════════════════════════════════════════════
async function loadState() {
  if (!readonlyContract) return;
  try {
    const [records, blocks, version] = await Promise.all([
      readonlyContract.getAllRecords(),
      readonlyContract.getAllBlocks(),
      readonlyContract.version()
    ]);
    state.records = records.map(recordFromChain);
    state.ledger  = blocks.map(blockFromChain);
    state.version = version;
  } catch (err) {
    showToast("Could not read chain state: " + (err.reason || err.message));
  }
}

function recordFromChain(r) {
  return {
    id: r.id, title: r.title, receiver: r.receiver, sender: r.sender,
    classification: r.classification, bytes: Number(r.byteSize),
    createdAt: new Date(Number(r.createdAt)).toISOString(),
    encryption: "AES-GCM/PBKDF2", contentDigest: r.contentDigest,
    ciphertext: r.ciphertext, iv: r.iv, salt: r.salt
  };
}

function blockFromChain(b) {
  return {
    index: Number(b.index), timestamp: new Date(Number(b.timestamp)).toISOString(),
    previousHash: b.previousHash, recordId: b.recordId, sender: b.sender,
    receiver: b.receiver, classification: b.classification,
    contentDigest: b.contentDigest, nonce: b.nonce, hash: b.hash
  };
}

// ════════════════════════════════════════════════════════════════════════════
// CONTRACT: SUBMIT SHARE
// ════════════════════════════════════════════════════════════════════════════
async function handleSubmit(event) {
  event.preventDefault();
  if (!state.walletConnected) { showToast("Connect your wallet first."); return; }
  const payload    = els.liveInput.value.trim();
  const title      = els.dataTitle.value.trim();
  const receiver   = els.receiverAddress.value.trim();
  const passphrase = els.passphrase.value;
  if (!payload || !title || !receiver) {
    showToast("Fill in title, receiver, and payload.");
    return;
  }
  if (passphrase.length < 8) { showToast("Passphrase must be 8+ characters."); return; }

  setFormBusy(true, "Encrypting…");
  try {
    const encrypted     = await encryptPayload(payload, passphrase);
    const contentDigest = await sha256(`${encrypted.ciphertext}:${encrypted.iv}:${encrypted.salt}`);
    const record = {
      id: makeId("share"), title, receiver,
      sender:         state.node.address,
      classification: els.classification.value,
      byteSize:       BigInt(encoder.encode(payload).length),
      createdAt:      BigInt(Date.now()),
      contentDigest,  ciphertext: encrypted.ciphertext,
      iv: encrypted.iv, salt: encrypted.salt
    };
    const block = await createBlock(record);
    setFormBusy(true, "Waiting for MetaMask…");
    const tx = await contract.addShare(record, block);
    setFormBusy(true, "Mining transaction…");
    flashActivity("Pending tx");
    showToast("Transaction submitted — waiting for confirmation…");
    const receipt = await tx.wait();
    await loadState();
    render();
    await verifyChain(false);
    els.liveInput.value = "";
    els.dataTitle.value = "";
    handleLiveInput();
    flashActivity("Confirmed");
    showToast(`Block confirmed in tx ${receipt.hash.slice(0, 10)}…`);
  } catch (err) {
    showToast(err.reason || err.data?.message || err.message || "Transaction failed.");
  } finally {
    setFormBusy(false);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CONTRACT: RESET
// ════════════════════════════════════════════════════════════════════════════
async function resetDemo() {
  if (!state.walletConnected) { showToast("Connect wallet first."); return; }
  if (!window.confirm("Reset ALL on-chain records? This requires a transaction.")) return;
  try {
    showToast("Submitting reset transaction…");
    const tx = await contract.reset();
    await tx.wait();
    await loadState();
    render();
    await verifyChain(false);
    showToast("On-chain ledger reset.");
  } catch (err) {
    showToast(err.reason || err.message || "Reset failed. Are you the contract owner?");
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CONTRACT EVENTS
// ════════════════════════════════════════════════════════════════════════════
function setupContractListeners() {
  if (!readonlyContract) return;
  readonlyContract.on("ShareAdded", async (blockIndex, recordId, submitter) => {
    flashActivity("On-chain event");
    showToast(`Block ${blockIndex} added by ${shortAddr(submitter)}`);
    await loadState(); render(); await verifyChain(false);
  });
  readonlyContract.on("ChainReset", async (by) => {
    flashActivity("Chain reset");
    showToast(`Ledger reset by ${shortAddr(by)}`);
    await loadState(); render(); await verifyChain(false);
  });
}

function setupBroadcastChannel() {
  if (!channel) return;
  channel.addEventListener("message", (e) => {
    if (!e.data || e.data.sourceId === state.sessionId) return;
    if (e.data.type === "draft-update") updateDraftIndicators(e.data.draft);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// CHAIN VERIFICATION
// ════════════════════════════════════════════════════════════════════════════
async function verifyChain(showResult) {
  let valid = true;
  for (let i = 0; i < state.ledger.length; i++) {
    const block        = state.ledger[i];
    const expectedPrev = i === 0 ? "0".repeat(64) : state.ledger[i - 1].hash;
    const { hash, ...fields } = block;
    const expectedHash = await sha256(stableStringify(fields));
    if (block.previousHash !== expectedPrev || hash !== expectedHash) { valid = false; break; }
  }
  els.chainStatus.textContent = state.ledger.length ? (valid ? "Valid" : "Broken") : "Empty";
  els.chainStatus.style.color = valid ? "var(--green-dark)" : "var(--red)";
  if (showResult) showToast(valid ? "Ledger verification passed." : "Ledger verification FAILED.");
  return valid;
}

// ════════════════════════════════════════════════════════════════════════════
// BLOCK CONSTRUCTION
// ════════════════════════════════════════════════════════════════════════════
async function createBlock(record) {
  const previousHash = state.ledger.length
    ? state.ledger[state.ledger.length - 1].hash : "0".repeat(64);
  const block = {
    index: BigInt(state.ledger.length + 1), timestamp: BigInt(Date.now()),
    previousHash, recordId: record.id, sender: record.sender,
    receiver: record.receiver, classification: record.classification,
    contentDigest: record.contentDigest, nonce: makeNonce()
  };
  const hashable = {
    index: Number(block.index), timestamp: Number(block.timestamp),
    previousHash: block.previousHash, recordId: block.recordId,
    sender: block.sender, receiver: block.receiver,
    classification: block.classification, contentDigest: block.contentDigest,
    nonce: block.nonce
  };
  block.hash = await sha256(stableStringify(hashable));
  return block;
}

// ════════════════════════════════════════════════════════════════════════════
// LIVE INPUT
// ════════════════════════════════════════════════════════════════════════════
function handleLiveInput() {
  const payload = els.liveInput.value;
  els.charCount.textContent   = `${payload.length} characters`;
  els.livePreview.textContent = payload || "Waiting for secure payload input…";
  els.lastInputAt.textContent = payload.length ? `Updated ${formatTime(new Date())}` : "Not typed yet";
  els.typingBadge.textContent = payload.length ? "Local input active" : "No active input";
  if (channel) channel.postMessage({
    type: "draft-update", sourceId: state.sessionId,
    draft: { nodeId: state.node.id, sourceId: state.sessionId,
             nodeName: state.node.name, payload, updatedAt: new Date().toISOString() }
  });
}

function updateDraftIndicators(draft) {
  if (!draft?.payload) return;
  els.typingBadge.textContent = `${draft.nodeName} typing`;
  els.lastInputAt.textContent = `Remote ${formatTime(new Date(draft.updatedAt))}`;
  flashActivity("Live input");
}

// ════════════════════════════════════════════════════════════════════════════
// RENDER
// ════════════════════════════════════════════════════════════════════════════
function render() {
  els.shareCount.textContent  = String(state.records.length);
  els.blockCount.textContent  = String(state.ledger.length);
  els.dbVersion.textContent   = `v${state.version}`;
  els.draftStatus.textContent = `v${state.version}`;
  els.latestHash.textContent  = state.ledger.length
    ? shortHash(state.ledger[state.ledger.length - 1].hash) : "No hash";
  renderRecords();
  renderLedger();
}

function renderRecords() {
  if (!state.records.length) {
    els.recordList.innerHTML = `<div class="empty-state">No encrypted records yet.</div>`;
    return;
  }
  els.recordList.innerHTML = state.records.slice().reverse().map((r) => `
    <article class="record-item">
      <div class="item-topline">
        <strong>${escapeHtml(r.title)}</strong>
        <span class="pill ${r.classification.toLowerCase()}">${escapeHtml(r.classification)}</span>
      </div>
      <span class="meta-line">to ${escapeHtml(r.receiver)} | ${formatDate(r.createdAt)}</span>
      <span class="meta-line">${r.encryption} | ${r.bytes} bytes</span>
      <span class="hash-line">digest ${shortHash(r.contentDigest)}</span>
    </article>`).join("");
}

function renderLedger() {
  if (!state.ledger.length) {
    els.ledgerList.innerHTML = `<div class="empty-state">No blocks have been mined.</div>`;
    return;
  }
  els.ledgerList.innerHTML = state.ledger.slice().reverse().map((b) => `
    <article class="block-item">
      <div class="item-topline">
        <strong>Block ${b.index}</strong>
        <span class="pill">${escapeHtml(b.classification)}</span>
      </div>
      <span class="meta-line">record ${escapeHtml(b.recordId)} | ${formatDate(b.timestamp)}</span>
      <span class="hash-line">hash ${b.hash}</span>
      <span class="hash-line">prev ${b.previousHash}</span>
    </article>`).join("");
}

// ════════════════════════════════════════════════════════════════════════════
// CANVAS
// ════════════════════════════════════════════════════════════════════════════
function renderCanvas(time = 0) {
  const w = els.canvas.width, h = els.canvas.height, cx = w/2, cy = h/2;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0f1715"; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(139,224,188,0.15)"; ctx.lineWidth = 1;
  for (let r = 1; r <= 4; r++) {
    ctx.beginPath(); ctx.arc(cx, cy, r*48 + state.canvasPulse*16, 0, Math.PI*2); ctx.stroke();
  }
  particles.forEach((p, i) => {
    const angle = p.angle + time * p.speed;
    const x = cx + Math.cos(angle) * p.radius;
    const y = cy + Math.sin(angle) * p.radius * 0.66;
    ctx.strokeStyle = "rgba(255,255,255,0.11)";
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
    ctx.fillStyle = p.color; ctx.globalAlpha = 0.72 + (i%4)*0.06;
    ctx.beginPath(); ctx.arc(x, y, 4+(i%3)+state.canvasPulse*3, 0, Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1;
  });
  const pulse = state.canvasPulse;
  ctx.fillStyle = "#e9fff6"; ctx.strokeStyle = "#8be0bc"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(cx-76, cy-35, 152, 70, 8); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#12211b"; ctx.font = "800 15px Inter,system-ui,sans-serif";
  ctx.textAlign = "center"; ctx.fillText("SECURE LEDGER", cx, cy-7);
  ctx.font = "700 12px Inter,system-ui,sans-serif"; ctx.fillStyle = "#426258";
  ctx.fillText(`${state.ledger.length} blocks | ${state.records.length} shares`, cx, cy+16);
  if (pulse > 0.02) {
    ctx.strokeStyle = `rgba(139,224,188,${pulse})`; ctx.lineWidth = 4;
    ctx.strokeRect(cx-84, cy-43, 168, 86);
  }
  state.canvasPulse = Math.max(0, state.canvasPulse - 0.018);
  requestAnimationFrame(renderCanvas);
}

// ════════════════════════════════════════════════════════════════════════════
// EVENTS
// ════════════════════════════════════════════════════════════════════════════
function bindStaticEvents() {
  els.overlayConnectBtn.addEventListener("click",  () => connectWallet());
  els.sidebarConnectBtn.addEventListener("click",  () => connectWallet());
  els.shareForm.addEventListener("submit",          handleSubmit);
  els.liveInput.addEventListener("input",           handleLiveInput);
  els.dataTitle.addEventListener("input",           () => { if(channel) handleLiveInput(); });
  els.loadSampleBtn.addEventListener("click",       loadSample);
  els.verifyChainBtn.addEventListener("click",      () => verifyChain(true));
  els.resetDemoBtn.addEventListener("click",        resetDemo);
}

function loadSample() {
  els.dataTitle.value       = "Anomaly packet capture";
  els.receiverAddress.value = "0x71B9-SIEM-NODE";
  els.classification.value  = "Restricted";
  els.passphrase.value      = els.passphrase.value || "secure-demo-key";
  els.liveInput.value = JSON.stringify({
    sourceIp: "10.44.12.8", destinationIp: "172.16.4.21",
    protocol: "TLS", anomalyScore: 0.91,
    signal: "Unusual outbound data volume",
    action: "Share encrypted evidence with SOC analyst"
  }, null, 2);
  handleLiveInput();
}

// ════════════════════════════════════════════════════════════════════════════
// CRYPTO
// ════════════════════════════════════════════════════════════════════════════
async function encryptPayload(payload, passphrase) {
  if (!crypto.subtle) throw new Error("Web Crypto unavailable. Use HTTPS or localhost.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const km   = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const key  = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" },
    km, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(payload));
  return { ciphertext: bufToBase64(ct), iv: bufToBase64(iv), salt: bufToBase64(salt) };
}

async function sha256(value) {
  const d = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2,"0")).join("");
}

function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════
function getOrCreateNode() {
  try {
    const s = localStorage.getItem("blockshare.node.v2");
    if (s) return JSON.parse(s);
  } catch {}
  const n = { id: makeId("node"), name: `Node ${Math.floor(100+Math.random()*900)}`, address: "" };
  localStorage.setItem("blockshare.node.v2", JSON.stringify(n));
  return n;
}
function setFormBusy(busy, label) {
  const btn = els.shareForm.querySelector(".primary-button");
  btn.disabled = busy;
  btn.textContent = busy ? (label||"Working…") : "Encrypt & submit transaction";
}
function flashActivity(label) {
  els.eventPulse.textContent = label; state.canvasPulse = 1;
  clearTimeout(flashActivity._t);
  flashActivity._t = setTimeout(() => { els.eventPulse.textContent = "Stable"; }, 1400);
}
function showToast(msg) {
  els.toast.textContent = msg; els.toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.remove("show"), 3200);
}
function setOverlayStatus(msg, isError) {
  if (!els.overlayStatus) return;
  els.overlayStatus.textContent = msg;
  els.overlayStatus.className = "overlay-status" + (isError ? " error" : "");
}
function bufToBase64(buf) {
  let bin = ""; new Uint8Array(buf).forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
}
function makeId(p)  { return `${p}_${Date.now().toString(36)}_${randomHex(3)}`; }
function makeNonce() { return randomHex(8); }
function randomHex(len) {
  return Array.from(crypto.getRandomValues(new Uint8Array(len)))
    .map(b=>b.toString(16).padStart(2,"0")).join("").toUpperCase();
}
function shortHash(h) { return h?.length>18 ? `${h.slice(0,10)}…${h.slice(-8)}` : h||"none"; }
function shortAddr(a) { return (!a||a.length<10) ? a : `${a.slice(0,6)}…${a.slice(-4)}`; }
function formatDate(v) {
  return new Intl.DateTimeFormat(undefined,{month:"short",day:"2-digit",hour:"2-digit",minute:"2-digit"})
    .format(new Date(v));
}
function formatTime(v) {
  return new Intl.DateTimeFormat(undefined,{hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(v);
}
function escapeHtml(v) {
  return String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

init();
