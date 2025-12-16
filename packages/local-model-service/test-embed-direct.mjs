import { getLlama } from 'node-llama-cpp';

async function main() {
  const modelPath = '/home/greggles/metahuman/models/nomic-embed-text-v1.5.Q4_K_M.gguf';
  
  console.log('Initializing llama...');
  const llama = await getLlama({ gpu: false });
  
  console.log('Loading model...');
  const model = await llama.loadModel({ modelPath, gpuLayers: 0 });
  
  const fileInfo = model.fileInfo;
  console.log('\n=== Model Info ===');
  console.log('Embedding vector size:', model.embeddingVectorSize);
  console.log('Train context size:', model.trainContextSize);
  
  console.log('\n=== GGUF Metadata ===');
  const metadata = fileInfo.metadata;
  const general = metadata.general;
  console.log('Architecture:', general?.architecture);
  
  const archName = general?.architecture;
  const archMeta = archName ? metadata[archName] : null;
  console.log('Architecture metadata keys:', archMeta ? Object.keys(archMeta) : 'not found');
  
  if (archMeta?.pooling_type !== undefined) {
    console.log('Pooling type:', archMeta.pooling_type);
  } else {
    console.log('Pooling type: NOT SET in metadata');
  }
  
  console.log('\n=== Creating Embedding Context ===');
  try {
    const embedCtx = await model.createEmbeddingContext();
    console.log('Embedding context created!');
    
    console.log('\n=== Testing Embedding ===');
    const embedding = await embedCtx.getEmbeddingFor('Hello world');
    console.log('Embedding dimensions:', embedding.vector.length);
    console.log('First 5 values:', embedding.vector.slice(0, 5));
    
    await embedCtx.dispose();
  } catch (err) {
    console.error('\n!!! Error:', err.message);
  }
  
  await model.dispose();
  await llama.dispose();
  process.exit(0);
}

main().catch(console.error);
