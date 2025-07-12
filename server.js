const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
});

const hostname = '0.0.0.0';
const port = process.env.PORT || 3000;

// 聊天室管理類別
class ChatRoomManager {
    constructor() {
        this.guestQueue = [];
        this.keysQueue = new Map();
        this.socketPairs = new Map();
        this.userPartners = new Map(); // 儲存用戶的配對關係
        this.userQueues = new Map(); // 追蹤用戶所在的佇列
        this.actions = {
            PAIR: "pair",
            CLEAR_PARTNER: "clearPartner",
            NEW_MSG: "newMsg",
            HANDSHAKE: "handshake",
            HANDSHAKE_SUCCESS: "handshakeSuccess",
            GOODBYE: "goodbye"
        };
        Object.freeze(this.actions);
    }

    // 註冊 socket
    registerSocket(socket) {
        this.socketPairs.set(socket.id, socket);
        console.log(`註冊 socket: ${socket.id}`);
    }

    // 取消註冊 socket
    unregisterSocket(socketId) {
        // 從佇列中移除用戶
        this.removeFromAllQueues(socketId);
        
        // 清理配對關係
        this.cleanupPairing(socketId);
        
        // 從 socket 池中移除
        this.socketPairs.delete(socketId);
        console.log(`取消註冊 socket: ${socketId}`);
    }

    // 從所有佇列中移除用戶
    removeFromAllQueues(socketId) {
        // 從一般佇列中移除
        this.guestQueue = this.guestQueue.filter(socket => socket.id !== socketId);
        
        // 從密語佇列中移除
        for (const [key, queue] of this.keysQueue.entries()) {
            const filteredQueue = queue.filter(socket => socket.id !== socketId);
            if (filteredQueue.length !== queue.length) {
                this.keysQueue.set(key, filteredQueue);
                console.log(`從密語佇列 ${key} 移除用戶: ${socketId}`);
            }
        }
        
        // 清理空佇列
        this.cleanupEmptyQueues();
    }

    // 從配對池中獲取夥伴
    getPartnerFromPair(socketId) {
        return this.socketPairs.get(socketId);
    }

    // 加入等待佇列
    addToWaitingQueue(socket, queue, queueType = 'guest') {
        // 確保用戶不在其他佇列中
        this.removeFromAllQueues(socket.id);
        
        // 將用戶加入佇列
        queue.push(socket);
        this.userQueues.set(socket.id, queueType);
        socket.emit("waiting", "配對中...");
        console.log(`加入等待佇列: ${socket.id}, 佇列類型: ${queueType}, 佇列長度: ${queue.length}`);
    }

    // 開始配對
    startPairing(socket, key) {
        const trimmedKey = key ? key.trim() : "";
        let queue;
        let queueType;

        if (trimmedKey) {
            // 密語配對
            if (!this.keysQueue.has(trimmedKey)) {
                this.keysQueue.set(trimmedKey, []);
            }
            queue = this.keysQueue.get(trimmedKey);
            queueType = `key:${trimmedKey}`;
            console.log(`密語配對: ${trimmedKey}, 佇列長度: ${queue.length}`);
        } else {
            // 一般配對
            queue = this.guestQueue;
            queueType = 'guest';
            console.log(`隨機配對, 佇列長度: ${queue.length}`);
        }

        // 檢查用戶是否已經在配對中
        if (this.userPartners.has(socket.id)) {
            console.log(`用戶 ${socket.id} 已經在配對中`);
            socket.emit("error", "您已經在聊天中，請先離開當前聊天");
            return;
        }

        // 檢查佇列中是否有其他用戶可以配對
        const availablePartners = queue.filter(s => s.id !== socket.id);
        
        if (availablePartners.length > 0) {
            // 找到配對夥伴
            const partner = availablePartners[0];
            // 從佇列中移除夥伴
            const partnerIndex = queue.findIndex(s => s.id === partner.id);
            if (partnerIndex !== -1) {
                queue.splice(partnerIndex, 1);
            }
            
            console.log(`配對成功: ${socket.id} 與 ${partner.id}`);
            this.pairUsers(socket, partner);
        } else {
            // 沒有可配對的用戶，加入等待佇列
            console.log(`加入等待佇列: ${socket.id}`);
            this.addToWaitingQueue(socket, queue, queueType);
        }
    }

    // 配對兩個用戶
    pairUsers(socket, partner) {
        console.log(`發送握手請求: ${partner.id} -> ${socket.id}`);
        
        // 從佇列中移除兩個用戶
        this.removeFromAllQueues(socket.id);
        this.removeFromAllQueues(partner.id);
        
        // 建立配對關係
        this.userPartners.set(socket.id, partner.id);
        this.userPartners.set(partner.id, socket.id);
        
        // 發送握手請求
        partner.emit("handshake", socket.id);
    }

    // 清理配對
    cleanupPairing(socketId) {
        const partnerId = this.userPartners.get(socketId);
        if (partnerId) {
            const partner = this.getPartnerFromPair(partnerId);
            if (partner) {
                partner.emit("partnerDisconnect", "對方已離開");
            }
            this.removeUserPartnership(socketId);
        }
    }

    // 移除用戶配對關係
    removeUserPartnership(socketId) {
        const partnerId = this.userPartners.get(socketId);
        if (partnerId) {
            this.userPartners.delete(socketId);
            this.userPartners.delete(partnerId);
            console.log(`移除配對關係: ${socketId} 與 ${partnerId}`);
        }
    }

    // 發送訊息給夥伴
    sendMessageToPartner(socket, message) {
        const partnerId = this.userPartners.get(socket.id);
        if (partnerId) {
            const partner = this.getPartnerFromPair(partnerId);
            if (partner && message) {
                console.log(`發送訊息: ${socket.id} -> ${partnerId}`);
                partner.emit("newMsg", message);
            } else {
                console.log(`找不到夥伴或訊息為空: ${socket.id}`);
                socket.emit("error", "無法發送訊息，請重新配對");
            }
        } else {
            console.log(`找不到夥伴: ${socket.id}`);
            socket.emit("error", "您尚未配對，請先配對");
        }
    }

    // 處理握手
    handleHandshake(socket, partnerId) {
        console.log(`處理握手: ${socket.id} -> ${partnerId}`);
        const partner = this.getPartnerFromPair(partnerId);
        if (partner) {
            console.log(`握手成功: ${socket.id} 與 ${partnerId}`);
            partner.emit("handshakeSuccess", "配對成功");
            socket.emit("handshakeSuccess", "配對成功");
        } else {
            console.log(`握手失敗: 找不到夥伴 ${partnerId}`);
            socket.emit("error", "配對失敗，請重新嘗試");
            // 清理配對關係
            this.removeUserPartnership(socket.id);
        }
    }

    // 處理離開
    handleGoodbye(socket) {
        const partnerId = this.userPartners.get(socket.id);
        if (partnerId) {
            const partner = this.getPartnerFromPair(partnerId);
            if (partner) {
                partner.emit("goodbye", "對方已離開");
            }
            this.removeUserPartnership(socket.id);
        }
    }

    // 清理空佇列
    cleanupEmptyQueues() {
        for (const [key, queue] of this.keysQueue.entries()) {
            if (queue.length === 0) {
                this.keysQueue.delete(key);
                console.log(`清理空密語佇列: ${key}`);
            }
        }
    }

    // 獲取配對統計
    getStats() {
        const keyQueuesInfo = {};
        for (const [key, queue] of this.keysQueue.entries()) {
            keyQueuesInfo[key] = queue.length;
        }
        
        return {
            totalUsers: this.socketPairs.size,
            totalPartnerships: this.userPartners.size / 2,
            guestQueueLength: this.guestQueue.length,
            keyQueuesCount: this.keysQueue.size,
            userQueuesCount: this.userQueues.size,
            keyQueuesInfo: keyQueuesInfo,
            timestamp: new Date().toISOString()
        };
    }
}

// 建立聊天室管理器實例
const chatManager = new ChatRoomManager();

// 靜態檔案服務
app.use(express.static(path.join(__dirname, 'static')));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "static", "index.html"));
});

// 健康檢查端點
app.get("/health", (req, res) => {
    const stats = chatManager.getStats();
    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        stats: stats
    });
});

// Socket.IO 連接處理
io.on("connection", (socket) => {
    console.log(`用戶連接: ${socket.id}`);
    
    // 註冊 socket
    chatManager.registerSocket(socket);
    
    // 配對事件
    socket.on(chatManager.actions.PAIR, (key) => {
        try {
            chatManager.startPairing(socket, key);
        } catch (error) {
            console.error('配對錯誤:', error);
            socket.emit("error", "配對失敗，請重試");
        }
    });

    // 斷線處理
    socket.on("disconnect", () => {
        console.log(`用戶斷線: ${socket.id}`);
        chatManager.unregisterSocket(socket.id);
    });

    // 清除配對資訊
    socket.on(chatManager.actions.CLEAR_PARTNER, () => {
        console.log(`用戶 ${socket.id} 清除配對資訊`);
        chatManager.removeUserPartnership(socket.id);
        chatManager.removeFromAllQueues(socket.id);
    });

    // 新訊息處理
    socket.on(chatManager.actions.NEW_MSG, (message) => {
        try {
            chatManager.sendMessageToPartner(socket, message);
        } catch (error) {
            console.error('發送訊息錯誤:', error);
            socket.emit("error", "發送訊息失敗");
        }
    });

    // 握手處理
    socket.on(chatManager.actions.HANDSHAKE, (uuid) => {
        try {
            chatManager.handleHandshake(socket, uuid);
        } catch (error) {
            console.error('握手錯誤:', error);
            socket.emit("error", "握手失敗");
        }
    });

    // 離開處理
    socket.on(chatManager.actions.GOODBYE, () => {
        try {
            chatManager.handleGoodbye(socket);
        } catch (error) {
            console.error('離開錯誤:', error);
        }
    });
});

// 錯誤處理中間件
app.use((err, req, res, next) => {
    console.error('伺服器錯誤:', err);
    res.status(500).json({ error: '內部伺服器錯誤' });
});

// 啟動伺服器
server.listen(port, hostname, () => {
    console.log(`伺服器運行在 http://${hostname}:${port}`);
    console.log(`專案目錄: ${__dirname}`);
});

// 優雅關閉
process.on('SIGTERM', () => {
    console.log('收到 SIGTERM 信號，正在關閉伺服器...');
    server.close(() => {
        console.log('伺服器已關閉');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('收到 SIGINT 信號，正在關閉伺服器...');
    server.close(() => {
        console.log('伺服器已關閉');
        process.exit(0);
    });
});