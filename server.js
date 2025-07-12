const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const hostname = '0.0.0.0';
const port = process.env.PORT || 3000;

// 聊天室管理類別
class ChatRoomManager {
    constructor() {
        this.guestQueue = [];
        this.keysQueue = new Map();
        this.socketPairs = new Map();
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
    }

    // 取消註冊 socket
    unregisterSocket(socketId) {
        this.socketPairs.delete(socketId);
    }

    // 從配對池中獲取夥伴
    getPartnerFromPair(socketId) {
        return this.socketPairs.get(socketId);
    }

    // 從佇列中獲取夥伴
    getPartnerFromQueue(queue) {
        return queue.length > 0 ? queue.pop() : null;
    }

    // 加入等待佇列
    addToWaitingQueue(socket, queue) {
        queue.push(socket);
        socket.emit("waiting", "配對中...");
    }

    // 開始配對
    startPairing(socket, key) {
        const trimmedKey = key ? key.trim() : "";
        let queue;

        if (trimmedKey) {
            // 密語配對
            if (!this.keysQueue.has(trimmedKey)) {
                this.keysQueue.set(trimmedKey, []);
            }
            queue = this.keysQueue.get(trimmedKey);
        } else {
            // 一般配對
            queue = this.guestQueue;
        }

        const partner = this.getPartnerFromQueue(queue);
        
        if (partner) {
            this.pairUsers(socket, partner);
        } else {
            this.addToWaitingQueue(socket, queue);
        }
    }

    // 配對兩個用戶
    pairUsers(socket, partner) {
        partner.emit("handshake", socket.id);
    }

    // 清理配對
    cleanupPairing(socket, partner) {
        if (partner) {
            partner.emit("partnerDisconnect", "對方已離開");
        }
    }

    // 發送訊息給夥伴
    sendMessageToPartner(socket, partner, message) {
        if (partner && message) {
            partner.emit("newMsg", message);
        }
    }

    // 處理握手
    handleHandshake(socket, partnerId) {
        const partner = this.getPartnerFromPair(partnerId);
        if (partner) {
            partner.emit("handshakeSuccess", "配對成功");
            socket.emit("handshakeSuccess", "配對成功");
        }
    }

    // 處理離開
    handleGoodbye(socket, partner) {
        if (partner) {
            partner.emit("goodbye", "對方已離開");
        }
    }

    // 清理空佇列
    cleanupEmptyQueues() {
        for (const [key, queue] of this.keysQueue.entries()) {
            if (queue.length === 0) {
                this.keysQueue.delete(key);
            }
        }
    }
}

// 建立聊天室管理器實例
const chatManager = new ChatRoomManager();

// 靜態檔案服務
app.use(express.static(path.join(__dirname, 'static')));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "static", "index.html"));
});

// Socket.IO 連接處理
io.on("connection", (socket) => {
    console.log(`用戶連接: ${socket.id}`);
    
    // 註冊 socket
    chatManager.registerSocket(socket);
    
    // 夥伴變數
    let partner = null;

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
        chatManager.cleanupPairing(socket, partner);
        chatManager.unregisterSocket(socket.id);
        chatManager.cleanupEmptyQueues();
    });

    // 清除配對資訊
    socket.on(chatManager.actions.CLEAR_PARTNER, () => {
        partner = null;
    });

    // 新訊息處理
    socket.on(chatManager.actions.NEW_MSG, (message) => {
        try {
            chatManager.sendMessageToPartner(socket, partner, message);
        } catch (error) {
            console.error('發送訊息錯誤:', error);
        }
    });

    // 握手處理
    socket.on(chatManager.actions.HANDSHAKE, (uuid) => {
        try {
            partner = chatManager.getPartnerFromPair(uuid);
            chatManager.handleHandshake(socket, uuid);
        } catch (error) {
            console.error('握手錯誤:', error);
        }
    });

    // 離開處理
    socket.on(chatManager.actions.GOODBYE, () => {
        try {
            chatManager.handleGoodbye(socket, partner);
            partner = null;
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

