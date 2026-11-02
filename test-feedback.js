#!/usr/bin/env node
const http = require('http');

const BASE_URL = process.env.API_BASE || 'http://localhost:3008';

function testFeedback() {
  const payload = JSON.stringify({
    email: 'test@example.com',
    content: '测试反馈：这是一个测试反馈内容，用于验证反馈系统是否正常工作。'
  });

  const options = {
    hostname: new URL(BASE_URL).hostname,
    port: new URL(BASE_URL).port || 80,
    path: '/api/feedback',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  console.log('测试反馈 API...');
  console.log(`POST ${BASE_URL}/api/feedback`);
  console.log('payload:', payload);
  console.log('');

  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      console.log(`状态码: ${res.statusCode}`);
      console.log('响应:', data);

      if (res.statusCode === 200) {
        console.log('\n✓ 反馈提交成功');
        process.exit(0);
      } else {
        console.log('\n✗ 反馈提交失败');
        process.exit(1);
      }
    });
  });

  req.on('error', (err) => {
    console.error('请求错误:', err.message);
    process.exit(1);
  });

  req.write(payload);
  req.end();
}

// 测试无邮箱情况
function testFeedbackNoEmail() {
  const payload = JSON.stringify({
    content: '匿名反馈测试'
  });

  const options = {
    hostname: new URL(BASE_URL).hostname,
    port: new URL(BASE_URL).port || 80,
    path: '/api/feedback',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  console.log('\n测试匿名反馈...');
  console.log('payload:', payload);

  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      console.log(`状态码: ${res.statusCode}`);
      console.log('响应:', data);

      if (res.statusCode === 200) {
        console.log('✓ 匿名反馈成功');
      } else {
        console.log('✗ 匿名反馈失败');
      }
    });
  });

  req.on('error', (err) => {
    console.error('请求错误:', err.message);
  });

  req.write(payload);
  req.end();
}

// 依次测试
testFeedback();
setTimeout(testFeedbackNoEmail, 1000);
