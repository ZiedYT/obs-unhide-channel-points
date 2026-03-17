
const obs = new OBSWebSocket();
const CLIENT_ID = 'o8psoh7xmn5zflmbj5g41vb7o3w8kb'; 
const REDIRECT_URI = window.location.origin + window.location.pathname;
let timeLeft = 0;
let timerActive = false;

// 1. Persistence & UI Logic
const getEl = (id) => document.getElementById(id);
const fields = ['obsPass', 'sceneName', 'sourceName', 'rewardId', 'duration', 'stackTime'];

function saveSettings() {
    fields.forEach(id => {
        const el = getEl(id);
        localStorage.setItem(id, el.type === 'checkbox' ? el.checked : el.value);
    });
}

function loadSettings() {
    fields.forEach(id => {
        const val = localStorage.getItem(id);
        if (val !== null) {
            const el = getEl(id);
            if (el.type === 'checkbox') el.checked = (val === 'true');
            else el.value = val;
        }
    });
}

// 2. Auth Handshake
getEl('authBtn').onclick = () => {
    saveSettings();
    const scopes = encodeURIComponent('channel:read:redemptions moderation:read');
    window.location.href = `https://id.twitch.tv/oauth2/authorize?response_type=token&client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=${scopes}`;
};

// 3. Main Logic
const hash = new URLSearchParams(window.location.hash.replace('#', '?'));
const token = hash.get('access_token');

if (token) {
    loadSettings();
    getEl('setup-ui').classList.add('hidden');
    getEl('active-ui').classList.remove('hidden');
    // Clear hash for security
    window.history.replaceState(null, null, window.location.pathname);
    start(token);
}

async function start(token) {
    // Connect OBS
    try {
        await obs.connect('ws://127.0.0.1:4455', getEl('obsPass').value);
        getEl('obsStatus').innerText = "OBS: Connected";
        getEl('obsStatus').className = "status connected";
    } catch (e) { console.error("OBS Connection Failed", e); }

    // Connect Twitch (ZiedYT logic)
    // First, get the ID for ZiedYT
    const userRes = await fetch('https://api.twitch.tv/helix/users?login=ZiedYT', {
        headers: { 'Authorization': `Bearer ${token}`, 'Client-Id': CLIENT_ID }
    });
    const userData = await userRes.json();
    const userId = userData.data[0].id;

    const socket = new WebSocket('wss://pubsub-edge.twitch.tv');
    socket.onopen = () => {
        getEl('twitchStatus').innerText = "Twitch: Connected (ZiedYT)";
        getEl('twitchStatus').className = "status connected";
        socket.send(JSON.stringify({
            type: 'LISTEN',
            data: { 
                topics: [`channel-points-channel-v1.${userId}`, `chat_moderator_actions.${userId}.${userId}`], 
                auth_token: token 
            }
        }));
        setInterval(() => socket.send(JSON.stringify({ type: 'PING' })), 240000);
    };

    socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'MESSAGE') {
            const inner = JSON.parse(msg.data.message);
            
            // Check Reward ID
            const isReward = inner.data?.redemption?.reward?.id === getEl('rewardId').value;
            // Check Mod Action (Ban/Timeout)
            const isMod = inner.data?.moderation_action === 'timeout' || inner.data?.moderation_action === 'ban';

            if (isReward || isMod) triggerEffect();
        }
    };
}

async function triggerEffect() {
    const dur = parseInt(getEl('duration').value);
    const isStacking = getEl('stackTime').checked;
    
    if (isStacking) timeLeft += dur;
    else timeLeft = dur;

    updateUI();
    
    // Show Source
    try {
        const { sceneItems } = await obs.call('GetSceneItemList', { sceneName: getEl('sceneName').value });
        const item = sceneItems.find(i => i.sourceName === getEl('sourceName').value);
        await obs.call('SetSceneItemEnabled', { 
            sceneName: getEl('sceneName').value, 
            sceneItemId: item.sceneItemId, 
            sceneItemEnabled: true 
        });
    } catch (e) { console.warn("Could not find source/scene"); }

    if (!timerActive) runTimer();
}

function runTimer() {
    timerActive = true;
    const interval = setInterval(async () => {
        timeLeft--;
        updateUI();

        if (timeLeft <= 0) {
            clearInterval(interval);
            timerActive = false;
            // Hide Source
            try {
                const { sceneItems } = await obs.call('GetSceneItemList', { sceneName: getEl('sceneName').value });
                const item = sceneItems.find(i => i.sourceName === getEl('sourceName').value);
                await obs.call('SetSceneItemEnabled', { 
                    sceneName: getEl('sceneName').value, 
                    sceneItemId: item.sceneItemId, 
                    sceneItemEnabled: false 
                });
            } catch (e) { }
        }
    }, 1000);
}

function updateUI() {
    getEl('timer-box').innerText = `${Math.max(0, timeLeft)}s`;
}

getEl('testBtn').onclick = triggerEffect;