export default async function onRequest(context) {
  try {
    const DEEPSEEK_API_KEY = context.env.DEEPSEEK_API_KEY;
    const DINGTALK_WEBHOOK = context.env.DINGTALK_WEBHOOK_URL;
    const DINGTALK_SECRET = context.env.DINGTALK_SECRET;

    // 解析请求体（支持两种触发方式）
    let fallEvent;
    if (context.request.method === 'POST') {
      fallEvent = await context.request.json();
    } else {
      // GET请求用于快速测试
      fallEvent = {
        device_id: "TEST_DEVICE",
        event: "fall_detected",
        confidence: 0.95,
        timestamp: Date.now()
      };
    }

    // 调用DeepSeek生成告警描述
    const dsResponse = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: '你是居家养老安全助手。收到跌倒检测事件后，生成一条自然、关切、简洁的告警描述。要求：30字以内，语气温和不引起恐慌，包含设备位置提示。'
          },
          {
            role: 'user',
            content: `检测到跌倒事件：设备${fallEvent.device_id}，置信度${(fallEvent.confidence * 100).toFixed(0)}%，时间${new Date(fallEvent.timestamp).toLocaleString('zh-CN')}`
          }
        ],
        max_tokens: 100,
        temperature: 0.7
      })
    });

    const dsResult = await dsResponse.json();
    const alertMessage = dsResult.choices[0].message.content;

    // 钉钉加签
    const timestamp = Date.now();
    const stringToSign = timestamp + '\n' + DINGTALK_SECRET;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(DINGTALK_SECRET);
    const messageData = encoder.encode(stringToSign);
    
    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
    const signBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
    const signEncoded = encodeURIComponent(signBase64);

    // 发送钉钉消息
    const dingtalkUrl = `${DINGTALK_WEBHOOK}&timestamp=${timestamp}&sign=${signEncoded}`;
    await fetch(dingtalkUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: {
          title: '跌倒告警',
          text: `## ⚠️ 跌倒告警\n\n${alertMessage}\n\n---\n- 设备：${fallEvent.device_id}\n- 置信度：${(fallEvent.confidence * 100).toFixed(0)}%\n- 时间：${new Date(fallEvent.timestamp).toLocaleString('zh-CN')}`
        }
      })
    });

    return new Response(JSON.stringify({
      success: true,
      alert: alertMessage,
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), { 
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}