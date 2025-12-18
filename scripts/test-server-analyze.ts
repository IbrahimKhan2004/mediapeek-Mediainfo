import fetch from 'node-fetch';

async function testServerAnalyze() {
  const url =
    'http://localhost:5173/resource/analyze?url=' +
    encodeURIComponent('https://media.w3.org/2010/05/sintel/trailer.mp4') +
    '&format=JSON';
  console.log('Testing URL:', url);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error('Request failed:', response.status, response.statusText);
      const text = await response.text();
      console.error('Response body:', text);
      return;
    }
    const data = await response.json();
    console.log('Analysis Result:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testServerAnalyze();
