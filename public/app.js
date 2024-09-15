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


let peerConnections = {};  // Armazenar as conexões de cada participante
let remoteStreams = {};    // Armazenar os fluxos de mídia de cada participante


// let peerConnection = null; // Representa o objeto RTCPeerConnection que gerencia a conexão de WebRTC entre os usuários
let localStream = null; //  Stream de mídia capturado localmente (câmera e/ou microfone) que será enviado para o peer.
// let remoteStream = null; // Stream de mídia recebida do peer remoto.
let roomDialog = null; // Diálogo para criar ou entrar em uma sala WebRTC.
let roomId = null; // Identificador da sala em que o usuário entrou ou criou
let screenStream = null; // Stream da tela compartilhada
let isScreenSharing = false; // Rastrear se a tela está sendo compartilhada

// Inicializa a aplicação
function init() {
  document.querySelector('#cameraBtn').addEventListener('click', openUserMedia); // Evento para capturar mídia do usuário (câmera/microfone).
  document.querySelector('#hangupBtn').addEventListener('click', hangUp); // Evento para finalizar a chamada e limpar os streams.
  document.querySelector('#createBtn').addEventListener('click', createRoom); // Evento para criar uma nova sala WebRTC.
  document.querySelector('#joinBtn').addEventListener('click', joinRoom); // Evento para entrar em uma sala WebRTC existente.
  document.querySelector('#screenShareBtn').addEventListener('click', startScreenShare); // Evento para iniciar o compartilhamento de tela.
  document.querySelector('#stopScreenShareBtn').addEventListener('click', stopScreenShare); // Evento para parar o compartilhamento de tela.
  roomDialog = new mdc.dialog.MDCDialog(document.querySelector('#room-dialog')); // Inicializa o diálogo modal para criação/entrada em uma sala.
}

// Cria uma sala
async function createRoom() {
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;
  const db = firebase.firestore();
  const roomRef = await db.collection('rooms').doc();

  console.log('Create PeerConnection with configuration: ', configuration);


  for (let i = 0; i<3; i++){
    peerConnections[i] = new RTCPeerConnection(configuration);
    remoteStreams[i] = new MediaStream(); // Fluxo de mídia para cada participante
    registerPeerConnectionListeners(peerConnections[i], i);  
      // para cada conexão adicionar mídia capturada
    localStream.getTracks().forEach(track => {
      peerConnections[i].addTrack(track, localStream);
    });

    const callerCandidatesCollection = roomRef.collection(`callerCandidates_${i}`);

    // Codigo para reunir candaditados na chamada, icecandidate
    peerConnections[i].addEventListener('icecandidate', event => {
      if (!event.candidate) {
        console.log('Got final candidate!');
        return;
      }
      console.log('Got candidate: ', event.candidate);
      callerCandidatesCollection.add(event.candidate.toJSON());
    });


    // Gereenciar fluxos de midia
    peerConnections[i].addEventListener('track', event => {
      console.log('Got remote track:', event.streams[0]);
      event.streams[0].getTracks().forEach(track => {
        console.log('Add a track to the remoteStream:', track);
        remoteStreams[i].addTrack(track);
      });
      document.querySelector(`#remoteVideo${i}`).srcObject = remoteStreams[i]; /////////////////////////////////

    });

      // Code for creating a room below
    const offer = await peerConnections[i].createOffer();
    await peerConnections[i].setLocalDescription(offer);
    console.log('Created offer:', offer);

    const roomWithOffer = {
      [`offer_${i}`]: {
        type: offer.type,
        sdp: offer.sdp,
      },
    };
    await roomRef.set(roomWithOffer, { merge: true });

    

  }

  roomId = roomRef.id;
  console.log(`New room created with SDP offer. Room ID: ${roomRef.id}`);
  document.querySelector(
    '#currentRoom').innerText = `Current room is ${roomRef.id} - You are the caller!`;


  for (let i = 0; i < 3; i++) {
    // Listening for remote session description below
    roomRef.onSnapshot(async snapshot => {
      const data = snapshot.data();
      if (!peerConnections[i].currentRemoteDescription && data && data[`answer_${i}`]) {
        console.log(`Got remote description for connection ${i}: `, data[`answer_${i}`]);
        const rtcSessionDescription = new RTCSessionDescription(data[`answer_${i}`]);
        await peerConnections[i].setRemoteDescription(rtcSessionDescription);
      }
    });

      // É acionada quando alguem entra na sala
    roomRef.collection(`calleeCandidates_${i}`).onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        if (change.type === 'added') {
          let data = change.doc.data();
          console.log(`Got new remote ICE candidate for connection ${i}: ${JSON.stringify(data)}`);
          await peerConnections[i].addIceCandidate(new RTCIceCandidate(data));
        }
      });
    });
  }


}


// Entra numa sala já criada 
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

    for (let i = 0; i < 3; i++) {
      peerConnections[i] = new RTCPeerConnection(configuration);
      remoteStreams[i] = new MediaStream();
      registerPeerConnectionListeners(peerConnections[i], i);
      localStream.getTracks().forEach(track => {
        peerConnections[i].addTrack(track, localStream);
      });
  
       // Code for collecting ICE candidates below
      const calleeCandidatesCollection = roomRef.collection(`calleeCandidates_${i}`);
      peerConnections[i].addEventListener('icecandidate', event => {
        if (!event.candidate) {
          console.log('Got final candidate!');
          return;
        }
        console.log('Got candidate joinRoomById: ', event.candidate);
        calleeCandidatesCollection.add(event.candidate.toJSON());
      });

      const offer = roomSnapshot.data()[`offer_${i}`];
      if(offer){
            // Code for creating SDP answer below
        await peerConnections[i].setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnections[i].createAnswer();
        console.log('Created answer:', answer);
        await peerConnections[i].setLocalDescription(answer);

        const roomWithAnswer = {
          [`answer_${i}`]: {
            type: answer.type,
            sdp: answer.sdp,
          },
        };
        await roomRef.update(roomWithAnswer);
      }


      // Adiciona mídia remota

      peerConnections[i].addEventListener('track', event => {
        console.log('Got remote track:', event.streams[0]);
        event.streams[0].getTracks().forEach(track => {
          console.log('Add a track to the remoteStream:', track);
          remoteStreams[i].addTrack(track);
        });
      });
  

      roomRef.collection('callerCandidates_${i}`').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(async change => {
          if (change.type === 'added') {
            let data = change.doc.data();
            console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
            await peerConnections[i].addIceCandidate(new RTCIceCandidate(data));
          }
        });
      });
    }


  }
}

async function openUserMedia(e) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

  // Configura o vídeo local
  document.querySelector('#localVideo').srcObject = stream;
  localStream = stream;

  console.log('Stream local:', document.querySelector('#localVideo').srcObject);

  // Habilitar/Desabilitar botões conforme necessário
  document.querySelector('#cameraBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = false;
  document.querySelector('#createBtn').disabled = false;
  document.querySelector('#hangupBtn').disabled = false;
  document.querySelector('#screenShareBtn').disabled = false;
  document.querySelector('#stopScreenShareBtn').disabled = false;
}

function registerPeerConnectionListeners(peer, index) {
  peer.addEventListener('icegatheringstatechange', () => {
    console.log(`ICE gathering state changed ${index}: ${peer.iceGatheringState}`);
  });

  peer.addEventListener('connectionstatechange', () => {
    console.log(`Connection state change ${index}: ${peer.connectionState}`);
  });

  // Aqui estava o erro. Substituindo peerConnection por peer
  peer.addEventListener('signalingstatechange', () => {
    console.log(`Signaling state change ${index}: ${peer.signalingState}`);
  });

  peer.addEventListener('iceconnectionstatechange', () => {
    console.log(`ICE connection state change ${index}: ${peer.iceConnectionState}`);
  });
}

// Função para compartilhar a tela
async function startScreenShare() {
  if (isScreenSharing) {
    console.log('A tela já está sendo compartilhada.');
    return;
  }

  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const localVideo = document.querySelector('#localVideo');
    localVideo.srcObject = screenStream;

    document.querySelector('#screenShareBtn').style.display = 'none';
    document.querySelector('#stopScreenShareBtn').style.display = 'inline-block';

    for (let i = 0; i < 3; i++) {
      if (peerConnections[i]) {
        const videoTrack = screenStream.getVideoTracks()[0];
        const sender = peerConnections[i].getSenders().find(s => s.track.kind === videoTrack.kind);
        if (sender) {
          peerConnections[i].removeTrack(sender);
        }
        peerConnections[i].addTrack(videoTrack, screenStream);
      }
    }
    localStream = null;
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

    // Atualiza todos os peerConnections com o novo track de vídeo
    for (let i = 0; i < 3; i++) {
      if (peerConnections[i]) {
        const videoTrack = localStream.getVideoTracks()[0];
        const sender = peerConnections[i].getSenders().find(s => s.track.kind === videoTrack.kind);
        if (sender) {
          peerConnections[i].removeTrack(sender);
        }
        peerConnections[i].addTrack(videoTrack, localStream);
      }
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


  for (let i = 0; i < 3; i++) {
    if (remoteStreams[i]) {
      remoteStreams[i].getTracks().forEach(track => track.stop());
    }
    if (peerConnections[i]) {
      if (peerConnections[i].connectionState !== 'closed') {
        peerConnections[i].close(); // Fecha a conexão WebRTC
      }
    }
  }

  document.querySelector('#localVideo').srcObject = null;
  document.querySelector('#remoteVideo0').srcObject = null;
  document.querySelector('#remoteVideo1').srcObject = null;
  document.querySelector('#remoteVideo2').srcObject = null;

  document.querySelector('#cameraBtn').disabled = false;
  document.querySelector('#joinBtn').disabled = true;
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#hangupBtn').disabled = true;
  document.querySelector('#screenShareBtn').disabled = true;
  document.querySelector('#stopScreenShareBtn').disabled = true;
  document.querySelector('#currentRoom').innerText = '';

  // Deleta a sala no hangup

  if (roomId) {
    const db = firebase.firestore();
    const roomRef = db.collection('rooms').doc(roomId);

    for (let i = 0; i<3; i++){

      const calleeCandidates = await roomRef.collection(`calleeCandidates_${i}`).get();
      calleeCandidates.forEach(async candidate => {
        await candidate.ref.delete();
      });
      const callerCandidates = await roomRef.collection(`calleeCandidates_${i}`).get();
      callerCandidates.forEach(async candidate => {
        await candidate.ref.delete();
      });

    }

    await roomRef.delete();
  }

  document.location.reload(true);
}


// Função para reiniciar caso o usuário recarregue a tela
window.onbeforeunload = function () {
  console.log('Reiniciando tela');

  if (peerConnection) {
    peerConnection.close();
  }

  // Para todos os streams locais
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }

  // Para o stream de tela, se estiver sendo compartilhado
  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
  }

  // peerConnection = null;
  localStream = null;
  // remoteStream = null;

  for(let i = 0; i<3 ; i++){
    remoteStreams[i] = null
    peerConnection[i] = null

  }
  screenStream = null;
  isScreenSharing = false;

   // Reseta os botões e interface
   document.querySelector('#cameraBtn').disabled = false;
   document.querySelector('#joinBtn').disabled = true;
   document.querySelector('#createBtn').disabled = true;
   document.querySelector('#hangupBtn').disabled = true;
   document.querySelector('#screenShareBtn').disabled = true;
   document.querySelector('#stopScreenShareBtn').disabled = true;
   document.querySelector('#currentRoom').innerText = '';
}

// Chama função que inicializa a aplicação
init();
