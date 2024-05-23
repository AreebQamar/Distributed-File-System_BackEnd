const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const fs = require('fs');

const packageDefinition = protoLoader.loadSync("../proto.proto", {});
const grpcObject = grpc.loadPackageDefinition(packageDefinition);
const ourFileSystem = grpcObject.distributedFileSystemPackage;

const MASTER_PORT = 50051;
const SLAVE_PORT_BASE = 50052;

let chunkServerCounter = 0;
const chunkServers = {}; // Store chunk server clients


//Master part of the master server, this acts as a master in the system.
//1. wait for the register request from the chunk server's slave part.
//2. upon receiving the register request, is saves the client id.
//3. this information will be used by the slave part of the master server.
function register(call, callback) {
  const clientId = call.request.id;
  console.log(`Register request from chunk server: ${clientId}`);
  const chunkServerPort = SLAVE_PORT_BASE + chunkServerCounter++;
  chunkServers[clientId] = { id: clientId, port: chunkServerPort };
  console.log(`Chunk Server ${clientId} registered.\n`);
  callback(null, { message: `Chunk server ${clientId} registered`, port: chunkServerPort });
}

function startMaster() {
  const server = new grpc.Server();
  server.addService(ourFileSystem.FileSystem.service, {
    Register: register
  });

  server.bindAsync(
    `localhost:${MASTER_PORT}`,
    grpc.ServerCredentials.createInsecure(),
    (error, port) => {
      if (error) {
        console.error(`Failed to bind server: ${error.message}\n`);
      } else {
        console.log(`Master server running at localhost:${port}\n`);
        server.start();
      }
    }
  );


  setInterval(() => {
    checkAndUpdateChunkServerStatus();
    
  }, 5000);

}

function checkAndUpdateChunkServerStatus(){
 
  for (const chunkServerId in chunkServers) {
    pingChunkServer(chunkServerId);
    // console.log(chunkServerId.id, chunkServerId.port);
  }
}
function markChunkServerOffline(chunkServerId){
  if (chunkServers[chunkServerId]) {
    delete chunkServers[chunkServerId];
  }
}
function pingChunkServer(chunkServerId) {

  const slave = new ourFileSystem.FileSystem(
    `localhost:${chunkServers[chunkServerId].port}`,
    grpc.credentials.createInsecure()
  );

  console.log(`sending ping to chunkServer: ${chunkServerId}`);
  slave.Ping({ id: chunkServers[chunkServerId].id}, (error, response) => {
    if (error) {
      console.error("Error \nMarking it offine.");
      markChunkServerOffline(chunkServerId);
    } else {
      console.log("response: ", response.message, "\n");
    }
  });
}

// Slave part (for chunk servers to register and store files)
function storeFile(call, callback) {
  const { client_id, filename, content } = call.request;
  console.log(`Received file for client: ${client_id}, filename: ${filename}`);

  fs.writeFile(filename, content, (err) => {
    if (err) {
      console.error(`Error writing file ${filename}:`, err);
      callback(null, { message: `Error writing file: ${filename}` });
      return;
    }

    console.log(`File ${filename} received and written successfully`);
    callback(null, { message: `File ${filename} received and written successfully` });
  });
}

function sendFileToChunkServer(chunkServerId, filename) {
  const chunkServerClient = chunkServers[chunkServerId].client;
  fs.readFile(filename, (err, data) => {
    if (err) {
      console.error(`Error reading file ${filename}:`, err);
      return;
    }

    chunkServerClient.StoreFile({ client_id: chunkServerId, filename, content: data }, (error, response) => {
      if (error) {
        console.error(`Error sending file to chunk server ${chunkServerId}:`, error);
      } else {
        console.log(`File sent to chunk server ${chunkServerId}:`, response.message);
      }
    });
  });
}


// Start the master and chunk server processes

startMaster();
