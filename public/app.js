mdc.ripple.MDCRipple.attachTo(document.querySelector('.mdc-button'));

const configuration = {
  iceServers: [
    {
      urls: [
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
      ],
    },
    {
      urls: "stun:stun.relay.metered.ca:80",
    },
    {
      urls: "turn:global.relay.metered.ca:80",
      username: "73961d1c52a6844d417e34a6",
      credential: "ApSuS/7WD65X8vbJ",
    },
    {
      urls: "turn:global.relay.metered.ca:80?transport=tcp",
      username: "73961d1c52a6844d417e34a6",
      credential: "ApSuS/7WD65X8vbJ",
    },
    {
      urls: "turn:global.relay.metered.ca:443",
      username: "73961d1c52a6844d417e34a6",
      credential: "ApSuS/7WD65X8vbJ",
    },
    {
      urls: "turns:global.relay.metered.ca:443?transport=tcp",
      username: "73961d1c52a6844d417e34a6",
      credential: "ApSuS/7WD65X8vbJ",
    },
  ],
  iceCandidatePoolSize: 10,
};

let peerConnection = null; // Representa o objeto RTCPeerConnection que gerencia a conexão de WebRTC entre os usuários
let localStream = null; //  Stream de mídia capturado localmente (câmera e/ou microfone) que será enviado para o peer.
let remoteStream = null; // Stream de mídia recebida do peer remoto.
let roomDialog = null; // Diálogo para criar ou entrar em uma sala WebRTC.
let roomId = null; // Identificador da sala em que o usuário entrou ou criou
let screenStream = null; // Stream da tela compartilhada
let isScreenSharing = false; // Rastrear se a tela está sendo compartilhada
let chatChannel = null; // Canal de dados para envio de mensagens diversas
let emojiChannel = null; // Canal de dados para envio de emoji

// Inicializa a aplicação
function init() {
  document.querySelector('#cameraBtn').addEventListener('click', openUserMedia); // Evento para capturar mídia do usuário (câmera/microfone).
  document.querySelector('#hangupBtn').addEventListener('click', hangUp); // Evento para finalizar a chamada e limpar os streams.
  document.querySelector('#createBtn').addEventListener('click', createRoom); // Evento para criar uma nova sala WebRTC.
  document.querySelector('#joinBtn').addEventListener('click', joinRoom); // Evento para entrar em uma sala WebRTC existente.
  document.querySelector('#screenShareBtn').addEventListener('click', startScreenShare); // Evento para iniciar o compartilhamento de tela.
  document.querySelector('#stopScreenShareBtn').addEventListener('click', stopScreenShare); // Evento para parar o compartilhamento de tela.
  document.querySelector('#raiseHandBtn').addEventListener('click', raiseHand); // Evento para levantar a mão na tela
  document.querySelector('#downHandBtn').addEventListener('click', downHand); // Evento para abaixar a mão na tela
  document.getElementById('sendBtn').addEventListener('click', sendMessage); // Evento para enviar mensagem no chat
  roomDialog = new mdc.dialog.MDCDialog(document.querySelector('#room-dialog')); // Inicializa o diálogo modal para criação/entrada em uma sala.
}

// Cria uma sala
async function createRoom() {
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;
  const db = firebase.firestore();
  const roomRef = await db.collection('rooms').doc();

  console.log('Create PeerConnection with configuration: ', configuration);
  peerConnection = new RTCPeerConnection(configuration);

  // Criando o Data Channel
  chatChannel = peerConnection.createDataChannel('chatChannel');
  emojiChannel = peerConnection.createDataChannel('emojiChannel');
  setupDataChannel(chatChannel);
  setupDataChannel(emojiChannel);

  registerPeerConnectionListeners();

  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  // Code for collecting ICE candidates below
  const callerCandidatesCollection = roomRef.collection('callerCandidates');

  peerConnection.addEventListener('icecandidate', event => {
    if (!event.candidate) {
      console.log('Got final candidate!');
      return;
    }
    //console.log('Got candidate: ', event.candidate);
    callerCandidatesCollection.add(event.candidate.toJSON());
  });
  // Code for collecting ICE candidates above

  // Code for creating a room below
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  console.log('Created offer:', offer);

  const roomWithOffer = {
    'offer': {
      type: offer.type,
      sdp: offer.sdp,
    },
  };
  await roomRef.set(roomWithOffer);
  roomId = roomRef.id;
  console.log(`New room created with SDP offer. Room ID: ${roomRef.id}`);
  document.querySelector(
    '#currentRoom').innerText = `Current room is ${roomRef.id} - You are the caller!`;
  // Code for creating a room above

  peerConnection.addEventListener('track', event => {
    console.log('Got remote track:', event.streams[0]);
    event.streams[0].getTracks().forEach(track => {
      console.log('Add a track to the remoteStream:', track);
      remoteStream.addTrack(track);
    });
  });

  // Listening for remote session description below
  roomRef.onSnapshot(async snapshot => {
    const data = snapshot.data();
    if (!peerConnection.currentRemoteDescription && data && data.answer) {
      console.log('Got remote description: ', data.answer);
      const rtcSessionDescription = new RTCSessionDescription(data.answer);
      await peerConnection.setRemoteDescription(rtcSessionDescription);
    }
  });
  // Listening for remote session description above

  // Listen for remote ICE candidates below
  roomRef.collection('calleeCandidates').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async change => {
      if (change.type === 'added') {
        let data = change.doc.data();
        //console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
        await peerConnection.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });
  // Listen for remote ICE candidates above
}

function joinRoom() {
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;

  document.querySelector('#confirmJoinBtn').
    addEventListener('click', async () => {
      roomId = document.querySelector('#room-id').value;
      console.log('Join room: ', roomId);
      document.querySelector(
        '#currentRoom').innerText = `Current room is ${roomId} - You are the callee!`;
      await joinRoomById(roomId);
    }, { once: true });
  roomDialog.open();
}

async function joinRoomById(roomId) {
  const db = firebase.firestore();
  const roomRef = db.collection('rooms').doc(`${roomId}`);
  const roomSnapshot = await roomRef.get();
  console.log('Got room:', roomSnapshot.exists);

  if (roomSnapshot.exists) {
    console.log('Create PeerConnection with configuration: ', configuration);
    peerConnection = new RTCPeerConnection(configuration);

    // Adicionando o listener para receber os Data Channels criados pelo caller
    peerConnection.addEventListener('datachannel', event => {
      const channel = event.channel;
      if (channel.label === 'chatChannel') {
        chatChannel = channel;
        setupDataChannel(chatChannel);
      } else if (channel.label === 'emojiChannel') {
        emojiChannel = channel;
        setupDataChannel(emojiChannel);
      }
    });

    registerPeerConnectionListeners();
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

    // Code for collecting ICE candidates below
    const calleeCandidatesCollection = roomRef.collection('calleeCandidates');
    peerConnection.addEventListener('icecandidate', event => {
      if (!event.candidate) {
        console.log('Got final candidate!');
        return;
      }
      //console.log('Got candidate: ', event.candidate);
      calleeCandidatesCollection.add(event.candidate.toJSON());
    });
    // Code for collecting ICE candidates above

    peerConnection.addEventListener('track', event => {
      console.log('Got remote track:', event.streams[0]);
      event.streams[0].getTracks().forEach(track => {
        console.log('Add a track to the remoteStream:', track);
        remoteStream.addTrack(track);
      });
    });

    // Code for creating SDP answer below
    const offer = roomSnapshot.data().offer;
    console.log('Got offer:', offer);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    console.log('Created answer:', answer);
    await peerConnection.setLocalDescription(answer);

    const roomWithAnswer = {
      answer: {
        type: answer.type,
        sdp: answer.sdp,
      },
    };
    await roomRef.update(roomWithAnswer);
    // Code for creating SDP answer above

    // Listening for remote ICE candidates below
    roomRef.collection('callerCandidates').onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        if (change.type === 'added') {
          let data = change.doc.data();
          //console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
          await peerConnection.addIceCandidate(new RTCIceCandidate(data));
        }
      });
    });
    // Listening for remote ICE candidates above
  }
}

async function openUserMedia(e) {
  const stream = await navigator.mediaDevices.getUserMedia(
    { video: true, audio: true });
  document.querySelector('#localVideo').srcObject = stream;
  localStream = stream;
  remoteStream = new MediaStream();
  document.querySelector('#remoteVideo').srcObject = remoteStream;

  console.log('Stream:', document.querySelector('#localVideo').srcObject);
  document.querySelector('#cameraBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = false;
  document.querySelector('#createBtn').disabled = false;
  document.querySelector('#hangupBtn').disabled = false;
  document.querySelector('#screenShareBtn').disabled = false;
  document.querySelector('#stopScreenShareBtn').disabled = false;
  document.querySelector('#raiseHandBtn').disabled = false;
  document.querySelector('#downHandBtn').disabled = false;
}

function registerPeerConnectionListeners() {
  peerConnection.addEventListener('icegatheringstatechange', () => {
    console.log(
      `ICE gathering state changed: ${peerConnection.iceGatheringState}`);
  });

  peerConnection.addEventListener('connectionstatechange', () => {
    console.log(`Connection state change: ${peerConnection.connectionState}`);
  });

  peerConnection.addEventListener('signalingstatechange', () => {
    console.log(`Signaling state change: ${peerConnection.signalingState}`);
  });

  peerConnection.addEventListener('iceconnectionstatechange ', () => {
    console.log(
      `ICE connection state change: ${peerConnection.iceConnectionState}`);
  });

  peerConnection.addEventListener('datachannel', event => {
    const channel = event.channel;
    console.log(`datachannel: ${channel}`);
  });
}

// Função para definir o canal de dados
function setupDataChannel(channel) {
  channel.onopen = () => console.log(`${channel.label} is open`);

  channel.onmessage = (event) => {
    const message = event.data;
    if (message === 'handRaisedUp') {
      // Exibe o emoji na tela remota
      document.getElementById('handEmojiRemote').style.display = 'block';
    } else if (message === 'handDown') {
      // Oculta o emoji na tela remota
      document.getElementById('handEmojiRemote').style.display = 'none';
    } else {
      addMessageToList(message, 'remote'); // Adiciona a mensagem recebida na lista
    }
  };

  channel.onerror = (error) => console.error('Data channel error:', error);
  channel.onclose = () => console.log(`${channel.label} is closed`);
}

// Função para levantar a mão
function raiseHand() {
  if (emojiChannel && emojiChannel.readyState === 'open') {
    console.log('Enviando "mão levantada" pelo canal de dados.');
    emojiChannel.send('handRaisedUp');

    // Exibe o emoji localmente
    document.getElementById('handEmoji').style.display = 'block';

    // Atualiza os botões
    document.querySelector('#raiseHandBtn').style.display = 'none';
    document.querySelector('#downHandBtn').style.display = 'inline-block';

  } else {
    console.error('Canal de dados não está disponível ou não está aberto.');
  }
}

// Função para abaixar a mão
function downHand() {
  if (emojiChannel && emojiChannel.readyState === 'open') {
    console.log('Enviando "mão abaixada" pelo canal de dados.');
    emojiChannel.send('handDown');

    // Oculta o emoji localmente
    document.getElementById('handEmoji').style.display = 'none';

    // Atualiza os botões
    document.querySelector('#raiseHandBtn').style.display = 'inline-block';
    document.querySelector('#downHandBtn').style.display = 'none';

  } else {
    console.error('Canal de dados não está disponível ou não está aberto.');
  }
}

// Função para enviar mensagens via canal de dados de chat
function sendMessage() {
  const messageInput = document.getElementById('messageInput');
  const message = messageInput.value.trim();

  if (message && chatChannel && chatChannel.readyState === 'open') {
      chatChannel.send(message);  // Envia a mensagem pelo canal de dados
      addMessageToList(message, 'local');  // Exibe a mensagem no chat localmente
      messageInput.value = '';  // Limpa o campo de entrada
  }
}

// Função para adicionar a mensagem à lista de mensagens
function addMessageToList(message, sender) {
  const messageList = document.getElementById('messageList');
  const newMessageItem = document.createElement('li');
  
  if (sender === 'local') {
      newMessageItem.textContent = `Você: ${message}`;
      newMessageItem.style.color = 'blue';  // Diferencia a mensagem local com cor
  } else if (sender === 'remote') {
      newMessageItem.textContent = `Remoto: ${message}`;
      newMessageItem.style.color = 'green';  // Diferencia a mensagem remota com outra cor
  }

  messageList.appendChild(newMessageItem);

  // Rola para a última mensagem
  messageList.scrollTop = messageList.scrollHeight;
}

// Função para compartilhar a tela
async function startScreenShare() {

  if (isScreenSharing) {
    console.log('A tela já está sendo compartilhada.');
    return;
  }

  try {
    // Obtém o stream da tela compartilhada
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });

    // Mostra a tela compartilhada no localVideo
    const localVideo = document.querySelector('#localVideo');
    localVideo.srcObject = screenStream;

    // Atualiza os botões
    document.querySelector('#screenShareBtn').style.display = 'none'; // Oculta botão de compartilhar tela
    document.querySelector('#stopScreenShareBtn').style.display = 'inline-block'; // Mostra botão de parar compartilhamento de tela

    // Se houver um peerConnection, atualize o track de vídeo
    if (peerConnection) {
      const videoTrack = screenStream.getVideoTracks()[0];
      const sender = peerConnection.getSenders().find(s => s.track.kind === videoTrack.kind);
      if (sender) {
        peerConnection.removeTrack(sender);
      }
      peerConnection.addTrack(videoTrack, screenStream);
    }
    localStream = null;
    // Armazena o stream compartilhado
    localStream = screenStream;
    isScreenSharing = true;

  } catch (error) {
    console.error('Error sharing screen:', error);
  }
}

// Função para parar de compartilhar a tela
async function stopScreenShare() {

  if (!isScreenSharing) {
    console.log('Nenhuma tela está sendo compartilhada.');
    return;
  }

  if (screenStream) {
    // Para todos os tracks do stream compartilhado
    screenStream.getTracks().forEach(track => track.stop());
  }

  try {
    // Restaura o stream da câmera no localVideo
    localStream = await navigator.mediaDevices.getUserMedia({ video: true });
    const localVideo = document.querySelector('#localVideo');
    localVideo.srcObject = localStream;

    // Atualiza os botões
    document.querySelector('#screenShareBtn').style.display = 'inline-block'; // Mostra botão de compartilhar tela
    document.querySelector('#stopScreenShareBtn').style.display = 'none'; // Oculta botão de parar compartilhamento de tela

    // Se houver um peerConnection, atualize o track de vídeo
    if (peerConnection) {
      const videoTrack = localStream.getVideoTracks()[0];
      const sender = peerConnection.getSenders().find(s => s.track.kind === videoTrack.kind);
      if (sender) {
        peerConnection.removeTrack(sender);
      }
      peerConnection.addTrack(videoTrack, localStream);
    }

  } catch (error) {
    console.error('Error accessing camera:', error);
  } finally {
    isScreenSharing = false;
  }
}

// Função para encerrar a chamada
async function hangUp(e) {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }

  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
  }

  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
  }

  // Verifica se a conexão ainda está aberta antes de fechar
  if (peerConnection) {
    if (peerConnection.connectionState !== 'closed') {
      peerConnection.close(); // Fecha a conexão WebRTC
    }
  }

  document.querySelector('#localVideo').srcObject = null;
  document.querySelector('#remoteVideo').srcObject = null;
  document.querySelector('#cameraBtn').disabled = false;
  document.querySelector('#joinBtn').disabled = true;
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#hangupBtn').disabled = true;
  document.querySelector('#screenShareBtn').disabled = true;
  document.querySelector('#stopScreenShareBtn').disabled = true;
  document.querySelector('#currentRoom').innerText = '';
  document.querySelector('#raiseHandBtn').disabled = true;
  document.querySelector('#downHandBtn').disabled = true;
  document.querySelector('#handEmoji').style.display = 'none';
  document.querySelector('#handEmojiRemote').style.display = 'none';

  // Deleta a sala no hangup
  if (roomId) {
    const db = firebase.firestore();
    const roomRef = db.collection('rooms').doc(roomId);
    const calleeCandidates = await roomRef.collection('calleeCandidates').get();
    calleeCandidates.forEach(async candidate => {
      await candidate.ref.delete();
    });
    const callerCandidates = await roomRef.collection('callerCandidates').get();
    callerCandidates.forEach(async candidate => {
      await candidate.ref.delete();
    });
    await roomRef.delete();
  }

  document.location.reload(true);
}

// Inicializa a aplicação
init();