document.addEventListener('DOMContentLoaded', function () {
    // --- DATABASE & CONFIGURATION ---
    const BACKEND_URL = "http://localhost:3000";
    
    let goalCounter = 0;
    let latestResults = null; 
    let chatHistory = []; 

    // (ฟังก์ชัน Debounce - ไม่เปลี่ยนแปลง)
    function debounce(func, delay) {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), delay);
        };
    }

    // --- DOM Elements ---
    // (ไม่เปลี่ยนแปลง)
    const nextBtn = document.getElementById('next-btn'), prevBtn = document.getElementById('prev-btn');
    const welcomeMessage = document.getElementById('welcome-message'), resultsContainer = document.getElementById('results-container');
    const formSteps = document.querySelectorAll('.form-step'), progressBar = document.getElementById('progress-bar');
    const goalsContainer = document.getElementById('goals-container');
    const saveCsvBtn = document.getElementById('save-csv-btn');
    const userNameEl = document.getElementById('user-name');
    const riskSummaryEl = document.getElementById('risk-profile-summary');
    const insuranceEl = document.getElementById('insurance-recommendation');
    const taxEl = document.getElementById('tax-recommendation'); 
    const feasibilityContainer = document.getElementById('goals-feasibility-container');
    const chatContainer = document.getElementById('chat-gemini-container');
    const chatMessages = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    const chatSendBtn = document.getElementById('chat-send-btn');
    let currentStep = 0;

    // --- FORM NAVIGATION & GOAL MANAGEMENT ---
    // (ไม่เปลี่ยนแปลง)
    const showStep = (stepIndex) => {
        formSteps.forEach((step, index) => step.classList.toggle('active-step', index === stepIndex));
        progressBar.style.width = `${((currentStep + 1) / formSteps.length) * 100}%`;
        prevBtn.style.display = currentStep === 0 ? 'none' : 'inline-block';
        nextBtn.textContent = currentStep === formSteps.length - 1 ? 'วิเคราะห์แผนการเงิน' : 'ถัดไป';
    };
    nextBtn.addEventListener('click', () => { if (currentStep < formSteps.length - 1) showStep(++currentStep); else runAnalysis(); });
    prevBtn.addEventListener('click', () => { if (currentStep > 0) showStep(--currentStep); });
    const addGoal = () => {
        goalCounter++;
        const goalBlock = document.createElement('div');
        goalBlock.className = 'goal-block';
        goalBlock.id = `goal-${goalCounter}`;
        goalBlock.innerHTML = `
            <h4>เป้าหมายที่ ${goalCounter}</h4>
            <div class="form-group"><label>ประเภทเป้าหมาย</label>
                <select class="goal-type">
                    <option value="เกษียณ">เกษียณ</option>
                    <option value="บ้าน/รถ">ซื้อบ้าน / รถ</option>
                    <option value="การศึกษาบุตร">การศึกษาบุตร</option>
                    <option value="ท่องเที่ยว">ท่องเที่ยว</option>
                    <option value="แต่งงาน">แต่งงาน</option>
                    <option value="ลงทุน">ลงทุนก้อนใหญ่</option>
                    <option value="ธุรกิจ">เริ่มต้นธุรกิจ</option>
                    <option value="อื่นๆ">อื่นๆ</option>
                </select>
            </div>
            <div class="form-grid">
                <div class="form-group"><label>ระยะเวลา (ปี)</label><input type="number" class="goal-horizon" placeholder="10"></div>
                <div class="form-group"><label>จำนวนเงินเป้าหมาย</label><input type="number" class="goal-amount" placeholder="3000000"></div>
            </div>
        `;
        goalsContainer.appendChild(goalBlock);
    };
    document.getElementById('add-goal-btn').addEventListener('click', addGoal);
    if(saveCsvBtn) saveCsvBtn.addEventListener('click', saveToCSV);

    // (fetchPricesInParallel - ไม่เปลี่ยนแปลง)
    async function fetchPricesInParallel(tickers) {
        const prices = {};
        const requests = tickers.map(async (symbol) => {
            if (!symbol) return;
            try {
                const response = await fetch(`${BACKEND_URL}/api/get-price?symbol=${symbol}`);
                const data = await response.json();
                prices[symbol] = data;
            } catch (error) {
                console.error(`Failed to fetch price for ${symbol}:`, error);
                prices[symbol] = { c: "N/A", pc: 0 };
            }
        });
        
        await Promise.all(requests); 
        return prices;
    }

    // (displayResults - ไม่เปลี่ยนแปลงจาก v16)
    // ❗️ ตรรกะ "Waterfall" (บรรทัด 320-344) ในนี้ถูกต้องแล้ว
    // ❗️ เรา "ต้อง" คำนวณ remainingSavings ที่ frontend
    // ❗️ เพราะ AI (v17) "ไม่ได้" ถูกสั่งให้จัดสรรเงินออม (Waterfall)
    // ❗️ AI (v17) ถูกสั่งให้ "คำนวณ" (required_savings_per_month) เท่านั้น
    const displayResults = (geminiResponse, goals, totalAvailableSavings) => {
        userNameEl.textContent = `คุณ ${document.getElementById('q_name').value}`;
        
        // 1. Risk & Persona (ไม่เปลี่ยนแปลง)
        riskSummaryEl.innerHTML = `
            <div class="persona">AI Persona: ${geminiResponse.persona}</div>
            <div class="risk-level ${geminiResponse.risk_level}">${geminiResponse.risk_name}</div>
            <p>${geminiResponse.risk_desc}</p>
        `;
        
        // 2. Insurance (ไม่เปลี่ยนแปลง)
        insuranceEl.innerHTML = '<h3>คำแนะนำด้านประกัน</h3>'; 
        if (geminiResponse.insurance_plan && geminiResponse.insurance_plan.length > 0) {
            geminiResponse.insurance_plan.forEach(item => {
                let detailsHtml = '';
                const coverage = item.estimated_coverage ? item.estimated_coverage.toLocaleString('th-TH') : 'N/A';
                const premium = item.estimated_premium_per_year ? item.estimated_premium_per_year.toLocaleString('th-TH') : 'N/A';
                detailsHtml = `
                    <div class="insurance-details">
                        <span><strong>ทุนคุ้มครอง (ประมาณ):</strong> ${coverage} บาท</span>
                        <span><strong>เบี้ย (ประมาณ/ปี):</strong> ${premium} บาท</span>
                    </div>`;
                
                insuranceEl.innerHTML += `
                    <div class="rec-card">
                        <h4>${item.name}</h4>
                        <p>${item.reason}</p>
                        ${detailsHtml} 
                    </div>`;
            });
            if (geminiResponse.disclaimer) {
                insuranceEl.innerHTML += `<p class="insurance-disclaimer">⚠️ ${geminiResponse.disclaimer}</p>`;
            }
        } else {
             insuranceEl.innerHTML += `<p>AI ไม่ได้แนะนำประกันเพิ่มเติมในขณะนี้</p>`;
        }

        // 3. Tax Plan (ไม่เปลี่ยนแปลง)
        const taxPlan = geminiResponse.tax_plan;
        if (taxPlan) {
            let recHtml = '<ul class="tax-rec-list">';
            if (taxPlan.recommendations && taxPlan.recommendations.length > 0) {
                 taxPlan.recommendations.forEach(rec => {
                    recHtml += `<li>
                        <strong>ซื้อ ${rec.product} เพิ่ม:</strong> 
                        <span>${rec.amount_to_buy.toLocaleString('th-TH')} บาท</span>
                        <small>(ประหยัดภาษี ~${rec.estimated_tax_saved.toLocaleString('th-TH')} บาท)</small>
                    </li>`;
                });
            } else {
                recHtml += '<li>AI ไม่ได้แนะนำให้ซื้อกองทุนลดหย่อนภาษีเพิ่มเติมในขณะนี้</li>';
            }
            recHtml += '</ul>';

            taxEl.innerHTML = `
                <h3>แผนการลดหย่อนภาษี (AI)</h3>
                <p>${taxPlan.summary || "AI กำลังวิเคราะห์แผนภาษี..."}</p>
                ${recHtml}
                <div class="tax-summary-highlight">
                    <div>
                        <label>ภาษีเดิม (ประมาณ)</label>
                        <span>${taxPlan.estimated_tax_payable_before.toLocaleString('th-TH')} บาท</span>
                    </div>
                    <div>
                        <label>ภาษีใหม่ (ประมาณ)</label>
                        <strong>${taxPlan.estimated_tax_payable_after.toLocaleString('th-TH')} บาท</strong>
                    </div>
                </div>
            `;
        } else {
            taxEl.innerHTML = '<h3>แผนการลดหย่อนภาษี (AI)</h3><p>AI ไม่ได้ให้คำแนะนำด้านภาษีในขณะนี้</p>';
        }

        // 4. Feasibility (ไม่เปลี่ยนแปลงจาก v16)
        feasibilityContainer.innerHTML = `<h3>การวิเคราะห์ความเป็นไปได้ตามเป้าหมาย (โดย AI)</h3>`;
        
        let remainingSavings = totalAvailableSavings; // ❗️ นี่คือ "เงินออมต่อเดือน"
        
        // ❗️ [ตรรกะ Waterfall ที่ 1] หักเงินออมภาษี (แปลงเป็นต่อเดือน)
        if (taxPlan && taxPlan.recommendations) {
            const taxSavingsPerYear = taxPlan.recommendations.reduce((sum, rec) => sum + rec.amount_to_buy, 0);
            remainingSavings = Math.max(0, remainingSavings - (taxSavingsPerYear / 12));
        }
        
        if (geminiResponse.goal_feasibility && geminiResponse.goal_feasibility.length > 0) {
            
            geminiResponse.goal_feasibility.forEach((item, index) => { 
                
                let percentClass = 'success'; 
                if (item.probability_of_success_percent < 75) percentClass = 'warning'; 
                if (item.probability_of_success_percent < 50) percentClass = 'danger'; 
                
                // ❗️ [ตรรกะ Waterfall ที่ 2] จัดสรรเงินออมให้เป้าหมายตามลำดับ
                const recommendedSavings = item.required_savings_per_month || 0;
                let actualInvestAmount = 0;
                if (remainingSavings >= recommendedSavings) {
                    actualInvestAmount = recommendedSavings; 
                    remainingSavings -= recommendedSavings; 
                } else if (remainingSavings > 0) {
                    actualInvestAmount = remainingSavings; 
                    remainingSavings = 0; 
                }
                
                let portfolioTableHtml = `<table class="portfolio-table"><thead><tr><th>สินทรัพย์</th><th>สัดส่วน (% / ยอดเงิน)</th><th>ราคา (USD)</th></tr></thead>
                                          <tbody id="portfolio-tbody-${index}">`; 
                
                if (item.investment_plan && item.investment_plan.assets) {
                    item.investment_plan.assets.forEach(asset => {
                        const monthlyAmount = (asset.percentage / 100) * actualInvestAmount; // ❗️ ใช้ actualInvestAmount
                        portfolioTableHtml += `
                            <tr id="price-row-${asset.ticker.replace('.', '-')}-${index}">
                                <td><b>${asset.name}</b><br><small>${asset.ticker}</small></td>
                                <td>
                                    <b>${asset.percentage}%</b>
                                    <br><small>(${monthlyAmount.toLocaleString('th-TH', { maximumFractionDigits: 0 })} บาท/เดือน)</small>
                                </td>
                                <td class="price-loading">Loading...</td> 
                            </tr>`;
                    });
                } else {
                     portfolioTableHtml += '<tr><td colspan="3">AI ไม่ได้แนะนำพอร์ตสำหรับเป้าหมายนี้</td></tr>';
                }
                portfolioTableHtml += '</tbody></table>';
                
                const savingsText = item.required_savings_per_month 
                    ? `<strong>เงินออมที่ AI แนะนำ:</strong> ${item.required_savings_per_month.toLocaleString('th-TH')} บาท/เดือน`
                    : `<strong>เงินออมที่ AI แนะนำ:</strong> (AI ไม่ได้ระบุ)`;

                let actualInvestText = '';
                if (actualInvestAmount > 0 && actualInvestAmount < recommendedSavings) {
                    actualInvestText = `<p class="invest-warning"><strong>เงินลงทุนจริง:</strong> ${actualInvestAmount.toLocaleString('th-TH')} บาท/เดือน (ลงทุนตามเงินออมที่เหลือ ซึ่งน้อยกว่าที่ AI แนะนำ)</p>`;
                } else if (actualInvestAmount === 0 && recommendedSavings > 0) {
                    actualInvestText = `<p class="invest-danger"><strong>เงินลงทุนจริง:</strong> 0 บาท/เดือน (เงินออมไม่เพียงพอสำหรับเป้าหมายนี้)</p>`;
                } else if (actualInvestAmount == recommendedSavings && actualInvestAmount > 0) {
                     actualInvestText = `<p class="invest-success"><strong>เงินลงทุนจริง:</strong> ${actualInvestAmount.toLocaleString('th-TH')} บาท/เดือน (เป็นไปตามที่ AI แนะนำ)</p>`;
                }

                
                feasibilityContainer.innerHTML += `
                    <div class="goal-card" id="goal-card-${index}">
                        <div class="goal-card-header">
                            <h4>แผน: ${item.goal_name}</h4>
                            <span class="portfolio-summary">${item.investment_plan?.summary || 'N/A'}</span>
                            <button class="sandbox-toggle-btn" data-goal-index="${index}">จำลองสถานการณ์ ⚙️</button>
                        </div>
                        <div class="goal-card-body">
                            <div class="probability-card">
                                <div class="percent ${percentClass}" id="goal-prob-${index}">${item.probability_of_success_percent}%</div>
                                <div class="label">โอกาสสำเร็จ (โดย AI)</div>
                            </div>
                            <div class="feasibility-details">
                                <p>${savingsText}</p>
                                ${actualInvestText} 
                                <p id="goal-analysis-${index}"><strong>บทวิเคราะห์ AI:</strong> ${item.analysis}</p>
                                <div class="scenario">
                                    <strong>Worst Case:</strong> ${item.worst_case_scenario}
                                </div>
                            </div>
                        </div>
                        <div style="padding: 0 20px 20px 20px;">
                            ${portfolioTableHtml} 
                        </div>
                        <div class="sandbox-controls" id="sandbox-controls-${index}">
                            <h4>จำลองสถานการณ์: ${item.goal_name}</h4>
                            <div class="form-group">
                                <label>ปรับเงินออมต่อเดือน (บาท): 
                                    <span id="sandbox-value-${index}">${actualInvestAmount.toLocaleString('th-TH')}</span>
                                </label>
                                <input type="range" class="sandbox-slider" 
                                       data-goal-index="${index}" 
                                       min="0" 
                                       max="${totalAvailableSavings * 1.5}" 
                                       value="${actualInvestAmount}" 
                                       step="1000">
                            </div>
                        </div>
                    </div>`;
            });
        } else {
            feasibilityContainer.innerHTML += "<p>AI ไม่ได้ให้ข้อมูลการวิเคราะห์ความเป็นไปได้ของเป้าหมาย</p>";
        }
        
        // 5. Chat (ไม่เปลี่ยนแปลง)
        chatContainer.classList.remove('chat-gemini-hidden');
        initializeChat(geminiResponse); 

        addSandboxListeners();
    };

    // (fetchAllPrices_AndUpdateUI - ไม่เปลี่ยนแปลง)
    async function fetchAllPrices_AndUpdateUI(geminiResponse) {
        // ... (โค้ดไม่เปลี่ยนแปลง) ...
        const allTickers = new Set();
        if (geminiResponse.goal_feasibility) {
            geminiResponse.goal_feasibility.forEach(goal => {
                if (goal.investment_plan && goal.investment_plan.assets) {
                    goal.investment_plan.assets.forEach(asset => {
                        allTickers.add(asset.ticker);
                    });
                }
            });
        }
        if (allTickers.size === 0) return; 
        const prices = await fetchPricesInParallel(Array.from(allTickers));
        latestResults.prices = prices; 
        geminiResponse.goal_feasibility.forEach((item, index) => {
            if (item.investment_plan && item.investment_plan.assets) {
                item.investment_plan.assets.forEach(asset => {
                    const priceData = prices[asset.ticker] || { c: "N/A", pc: 0 }; 
                    let priceClass = 'price-loading';
                    if (priceData.c !== 'N/A' && priceData.pc !== 0) {
                        const change = priceData.c - priceData.pc;
                        if (change > 0) priceClass = 'price-up';
                        if (change < 0) priceClass = 'price-down';
                    }
                    const rowId = `price-row-${asset.ticker.replace('.', '-')}-${index}`;
                    const row = document.getElementById(rowId);
                    if (row) {
                        const priceCell = row.cells[2]; 
                        priceCell.innerHTML = `$${priceData.c}`;
                        priceCell.className = priceClass;
                    }
                });
            }
        });
    }


    // ❗️ [อัปเกรด v18] ฟังก์ชัน runAnalysis
    const runAnalysis = async () => {
        nextBtn.textContent = 'กำลังวิเคราะห์ (AI)...';
        nextBtn.disabled = true;

        const formData = {
            q_name: document.getElementById('q_name').value,
            q_age: document.getElementById('q_age').value,
            q_income: document.getElementById('q_income').value,
            q_fixed_expenses: document.getElementById('q_fixed_expenses').value,
            q_emergency_savings: document.getElementById('q_emergency_savings').value,
            q_dependents: Array.from(document.querySelectorAll('#q_dependents input:checked')).map(cb => cb.value),
            q_experience: document.getElementById('q_experience').value,
            q_knowledge: document.getElementById('q_knowledge').value,
            q_volatility_reaction: document.getElementById('q_volatility_reaction').value,
            q_goal_priority: document.getElementById('q_goal_priority').value,
            q_filing_status: document.getElementById('q_filing_status').value,
            q_rmf_current: document.getElementById('q_rmf_current').value || 0,
            q_ssf_current: document.getElementById('q_ssf_current').value || 0,
            q_insurance_life: document.getElementById('q_insurance_life').value || 0,
            q_insurance_health_self: document.getElementById('q_insurance_health_self').value || 0,
            q_insurance_health_parents: document.getElementById('q_insurance_health_parents').value || 0,
            q_home_loan_interest: document.getElementById('q_home_loan_interest').value || 0
        };

        let geminiResponse;
        
        const goals = [];
        document.querySelectorAll('.goal-block').forEach(block => {
            goals.push({
                type: block.querySelector('.goal-type').value,
                horizon: block.querySelector('.goal-horizon').value || 10,
                amount: block.querySelector('.goal-amount').value || 1000000
            });
        });
        formData.goals = goals; 

        try {
            const response = await fetch(`${BACKEND_URL}/api/get-gemini-analysis`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            
            if (!response.ok) {
                const errorData = await response.json(); 
                throw new Error(errorData.error || 'Failed to get analysis from server');
            }
            
            geminiResponse = await response.json(); 
            console.log("Gemini Analysis (Full Plan):", geminiResponse);
            
            latestResults = geminiResponse; 
            latestResults.formData = formData; 
            
            // ❗️❗️❗️ [แก้ไข v18] แก้บั๊กจำลองสถานการณ์
            // จับคู่ Goal (จากฟอร์ม) กับ Feasibility (จาก AI) โดยใช้ Index
            // (วิธีนี้เสถียรกว่าการเดาชื่อ)
            latestResults.goal_feasibility.forEach((feasibilityGoal, index) => {
                if (goals[index]) { // Map by index
                    feasibilityGoal.horizon = goals[index].horizon;
                    feasibilityGoal.amount = goals[index].amount;
                } else {
                    console.warn(`Mismatch between goals and feasibility at index ${index}`);
                }
            });


        } catch (error) {
            console.error(error);
            alert("เกิดข้อผิดพลาดในการเรียก AI: " + error.message);
            nextBtn.textContent = 'วิเคราะห์แผนการเงิน';
            nextBtn.disabled = false;
            return;
        }
        
        const totalAvailableSavings = Math.max(0, parseFloat(formData.q_income || 0) - parseFloat(formData.q_fixed_expenses || 0) - parseFloat(formData.q_emergency_savings || 0));
        
        welcomeMessage.style.display = 'none';
        resultsContainer.classList.remove('results-hidden');
        
        displayResults(geminiResponse, goals, totalAvailableSavings); 
        fetchAllPrices_AndUpdateUI(geminiResponse); 

        nextBtn.textContent = 'วิเคราะห์แผนการเงิน';
        nextBtn.disabled = false;
    };


    // (ฟังก์ชัน Sandbox - ไม่เปลี่ยนแปลงจาก v16)
    function addSandboxListeners() {
        feasibilityContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('sandbox-toggle-btn')) {
                const index = e.target.dataset.goalIndex;
                const controls = document.getElementById(`sandbox-controls-${index}`);
                controls.classList.toggle('active');
            }
        });
        feasibilityContainer.addEventListener('input', debounce(async (e) => {
            if (e.target.classList.contains('sandbox-slider')) {
                await handleSandboxSliderChange(e.target);
            }
        }, 500));
    }

    // (ฟังก์ชัน Sandbox - ไม่เปลี่ยนแปลงจาก v16)
    async function handleSandboxSliderChange(slider) {
        const index = slider.dataset.goalIndex;
        const newSavings = slider.value;
        
        document.getElementById(`sandbox-value-${index}`).textContent = parseFloat(newSavings).toLocaleString('th-TH');
        
        const probEl = document.getElementById(`goal-prob-${index}`);
        const analysisEl = document.getElementById(`goal-analysis-${index}`);
        
        probEl.classList.add('prob-loading');
        analysisEl.textContent = 'กำลังคำนวณใหม่...';

        try {
            const originalGoal = latestResults.goal_feasibility[index]; // ❗️ ตอนนี้จะมี .horizon และ .amount ที่ถูกต้อง
            const investmentPlan = originalGoal.investment_plan;
            const clientProfile = latestResults.formData;

            const response = await fetch(`${BACKEND_URL}/api/resimulate-goal`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    originalGoal: {
                        goal_name: originalGoal.goal_name,
                        horizon: originalGoal.horizon, // ❗️ ส่งค่าที่ถูกต้องไป
                        amount: originalGoal.amount // ❗️ ส่งค่าที่ถูกต้องไป
                    },
                    newSavingsPerMonth: newSavings,
                    clientProfile: clientProfile,
                    investmentPlan: investmentPlan 
                })
            });

            if (!response.ok) {
                throw new Error('Simulation API failed');
            }

            const newFeasibility = await response.json();

            probEl.textContent = `${newFeasibility.probability_of_success_percent}%`;
            analysisEl.innerHTML = `<strong>บทวิเคราะห์ AI (จำลอง):</strong> ${newFeasibility.analysis}`;

            probEl.className = 'percent'; 
            if (newFeasibility.probability_of_success_percent < 75) probEl.classList.add('warning'); 
            else if (newFeasibility.probability_of_success_percent < 50) probEl.classList.add('danger'); 
            else probEl.classList.add('success'); 
            
        } catch (error) {
            console.error('Sandbox error:', error);
            analysisEl.textContent = 'เกิดข้อผิดพลาดในการจำลอง';
        } finally {
            probEl.classList.remove('prob-loading');
        }
    }
    
    // (ฟังก์ชัน Chat - ไม่เปลี่ยนแปลง)
    function initializeChat(originalPlan) {
        chatHistory = []; 
        chatMessages.innerHTML = '<div class="chat-message bot">สวัสดีครับ! ผมคือผู้ช่วย AI (Gemini) มีอะไรให้ผมอธิบายเกี่ยวกับแผนนี้เพิ่มเติมไหมครับ?</div>'; 
        chatSendBtn.onclick = sendChatMessage;
        chatInput.onkeyup = (e) => {
            if (e.key === 'Enter') sendChatMessage();
        };
        async function sendChatMessage() {
            const message = chatInput.value.trim();
            if (!message) return;
            addMessageToUI(message, 'user');
            chatInput.value = '';
            chatSendBtn.disabled = true;
            chatSendBtn.textContent = 'AI...';
            try {
                const response = await fetch(`${BACKEND_URL}/api/chat-with-plan`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        originalPlan: originalPlan, 
                        chatHistory: chatHistory,   
                        newMessage: message
                    })
                });
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'AI Chat Error');
                }
                const data = await response.json();
                addMessageToUI(data.reply, 'bot');
                chatHistory.push({ role: 'user', text: message });
                chatHistory.push({ role: 'model', text: data.reply });
            } catch (error) {
                addMessageToUI(`ขออภัยครับ เกิดข้อผิดพลาด: ${error.message}`, 'bot');
            }
            chatSendBtn.disabled = false;
            chatSendBtn.textContent = 'ส่ง';
        }
        function addMessageToUI(message, role) {
            const msgDiv = document.createElement('div');
            msgDiv.className = `chat-message ${role}`;
            msgDiv.textContent = message;
            chatMessages.appendChild(msgDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight; 
        }
    }
    
    // (CSV EXPORT - ไม่เปลี่ยนแปลง)
    function saveToCSV() {
        if (!latestResults) { alert("กรุณาวิเคราะห์แผนก่อน"); return; }
        const geminiResponse = latestResults; 
        const user = {
            name: document.getElementById('q_name').value,
            age: document.getElementById('q_age').value,
            income: document.getElementById('q_income').value,
            expenses: document.getElementById('q_fixed_expenses').value,
            emergency: document.getElementById('q_emergency_savings').value
        };
        const prices = geminiResponse.prices || {}; 
        let csvContent = "data:text/csv;charset=utf-8,";
        csvContent += "AI Financial Plan for " + user.name + "\r\n";
        csvContent += "Persona," + geminiResponse.persona + "\r\n";
        csvContent += "Risk Profile," + geminiResponse.risk_name + "\r\n";
        csvContent += "\r\n";
        csvContent += "Tax Plan Analysis\r\n";
        if (geminiResponse.tax_plan) {
            const tax = geminiResponse.tax_plan;
            csvContent += `Summary,"${tax.summary}"\r\n`;
            csvContent += `Est. Tax Before,${tax.estimated_tax_payable_before}\r\n`;
            csvContent += `Est. Tax After,${tax.estimated_tax_payable_after}\r\n`;
            csvContent += `Total Saved,${tax.total_tax_saved}\r\n`;
            csvContent += "Tax Recommendations\r\n";
            csvContent += "Product,Amount to Buy,Est. Tax Saved\r\n";
            tax.recommendations.forEach(rec => {
                csvContent += `${rec.product},${rec.amount_to_buy},${rec.estimated_tax_saved}\r\n`;
            });
        }
        csvContent += "\r\n";
        csvContent += "Goal Feasibility Analysis (from AI)\r\n";
        csvContent += "Goal Name,Probability (%),Required Savings,AI Analysis,Worst Case\r\n";
        if (geminiResponse.goal_feasibility) {
            geminiResponse.goal_feasibility.forEach(item => {
                const savings = item.required_savings_per_month ? item.required_savings_per_month : "N/A";
                csvContent += `"${item.goal_name}",${item.probability_of_success_percent},${savings},"${item.analysis}","${item.worst_case_scenario}"\r\n`;
                csvContent += "Sub-Portfolio for this Goal\r\n";
                csvContent += "Asset Name,Ticker,Percentage (%),Live Price (USD)\r\n"; 
                if (item.investment_plan && item.investment_plan.assets) { 
                    item.investment_plan.assets.forEach(asset => {
                        const price = prices[asset.ticker] ? prices[asset.ticker].c : "N/A";
                        csvContent += `"${asset.name}",${asset.ticker},${asset.percentage},${price}\r\n`;
                    });
                }
                csvContent += "\r\n";
            });
        }
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "financial_plan_" + user.name + ".csv");
        document.body.appendChild(link); 
        link.click();
        document.body.removeChild(link);
    }
    
    // --- INIT ---
    addGoal(); 
    showStep(currentStep); 

});