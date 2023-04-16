const http = require("http");
const express = require("express");
const {Server} = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const hostname = '127.0.0.1';
const port = 3000;

// normal connect pool
let guestQueue = [];
// specify key pool
let keysQueue = {};
// socket id pare
let pare = {};
// actions
const Actions = {
    pair : "pair",
    clearPartner : "clearPartner",
    newMsg : "newMsg",
    handshack : "handshack",
    handshackSuccess : "handshackSuccess"
    };
Object.freeze(Actions);


app.get("/", (req, res) => {
	res.sendFile(__dirname +"/static/index.html");
});

io.on("connection", (socket) => {
    // 註冊
    registerInPare(socket);
    // 夥伴
    let partner;
    // 開始配對事件
    socket.on("pair", (key) => {
        key = key.trim();
        // 要排隊或是找夥伴的佇列
        let queue;
        // 密語配對
        if(key){
            let keyQueue = keysQueue[key];
            if (!keyQueue){
                keyQueue = [];
                keysQueue[key] = keyQueue;
            }
            queue = keyQueue;
        }
        // 一般配對
        else{
            queue = guestQueue;
        }
        // 配對或是等待
        if (queue.length > 0){
            partner = getPartner(queue);
            goPair(socket, partner);
        }else{
            goWaiting(socket, queue);
        }
    });

    // 88
    socket.on("disconnect", () => {
        if (partner){
            partner.emit("partnerDisconnect", "對方已離開");
        }
    });
    // 清除配對資訊
    socket.on("clearPartner", () => {
        partner = null;
    });
    // 接收到新訊息，發給搭檔
    socket.on("newMsg", (msg) => {
        if(partner){
            partner.emit("newMsg", msg);
        }
    });

    // 與新搭檔配對
    socket.on("handshack", (uuid) => {
        partner = getPartnerFromPair(uuid);
        if(partner){
            partner.emit("handshackSuccess", "配對成功");
            socket.emit("handshackSuccess", "配對成功");
        }
    });

    // 與新搭檔配對
    socket.on("goodbye", () => {
        if(partner){
            partner.emit("goodbye", "對方已離開");
            partner = null;
        }
    });
});

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});

function goWaiting(socket, queue){
    queue.push(socket);
    socket.emit("waiting", "配對中");
}

function goPair(socket, partner){
    partner.emit("handshack", socket.id);
}

function registerInPare(socket){
    pare[socket.id] = socket;
}

function unRegisterInPare(socket){
    pare[socket.id] = null;
}

function getPartnerFromPair(uuid){
    return pare[uuid];
}

function getPartner(queue){
    return queue.pop();
}

