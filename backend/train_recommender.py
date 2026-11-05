"""Train the shared DQN using synthetic profiles only (never student records)."""
from __future__ import annotations

import random
import json
from pathlib import Path

import numpy as np
import torch
from torch import nn
from backend.recommender import ACTIVITIES, POLICY_PATH, QNetwork

SEED = 42
random.seed(SEED); np.random.seed(SEED); torch.manual_seed(SEED); torch.set_num_threads(1)
DEVICE = torch.device("cpu")


def synthetic_state():
    # Seven normalized self-report indicators, CNN trend category, previous feedback, preferences.
    features = np.random.uniform(-1, 1, 7).astype(np.float32)
    trend = np.zeros(5, np.float32); trend[np.random.randint(0, 5)] = 1
    feedback = np.random.choice([-1, 0, 0, 0, 1], 10).astype(np.float32)
    prefs = np.random.choice([0, 1], 10, p=[0.8, 0.2]).astype(np.float32)
    return np.concatenate([features, trend, feedback, prefs])


def simulated_reward(state, action):
    mood, stress, sleep, workload, study, activity, breaks = state[:7]
    trend = int(np.argmax(state[7:12]))
    feedback = state[12:22]
    prefs = state[22:32]
    # Synthetic immediate utility encourages plausible matching, preference relevance, and prior helpful feedback.
    relief = 0.0
    if action in (0, 1, 2, 3, 4, 5): relief += max(0, stress) * (0.2 if action < 5 else 0.15)
    if action == 6: relief += max(0, study - 0.1) * 0.3 + max(0, workload) * 0.12
    if action == 7: relief += max(0, workload) * 0.32 + max(0, study) * 0.12
    if action == 8: relief += max(0, -sleep) * 0.35
    if action == 9: relief += max(0, -mood) * 0.15 + max(0, stress) * 0.08
    if trend == 1 and action in (0, 1, 2, 3, 4, 6, 7): relief += 0.2
    if trend == 2 and action in (5, 8, 9): relief += 0.2
    return float(relief + 0.65 * prefs[action] + 0.6 * max(0, feedback[action]) - 0.25 * max(0, -feedback[action]))


def main():
    network = QNetwork().to(DEVICE)
    optimizer = torch.optim.Adam(network.parameters(), lr=0.001)
    loss_fn = nn.MSELoss()
    # One-step terminal episodes are a contextual-bandit environment (DQN, gamma=0).
    for step in range(2000):
        states = np.stack([synthetic_state() for _ in range(128)])
        actions = np.random.randint(0, 10, 128)
        rewards = np.asarray([simulated_reward(s, int(a)) for s, a in zip(states, actions)], dtype=np.float32)
        x = torch.from_numpy(states)
        predicted = network(x).gather(1, torch.from_numpy(actions).long().unsqueeze(1)).squeeze(1)
        loss = loss_fn(predicted, torch.from_numpy(rewards))
        optimizer.zero_grad(); loss.backward(); optimizer.step()
    POLICY_PATH.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": network.cpu().state_dict(), "seed": SEED, "training_profiles": "synthetic only", "environment": "one-step simulated student support contextual-bandit DQN", "state_dimensions": 32, "action_ids": [x["id"] for x in ACTIVITIES]}, POLICY_PATH)
    heldout = [synthetic_state() for _ in range(2000)]
    network.eval()
    with torch.inference_mode():
        choices = network(torch.from_numpy(np.stack(heldout))).argmax(dim=1).numpy()
    def fixed_rule(s):
        mood, stress, sleep, workload, study = s[0], s[1], s[2], s[3], s[4]
        if stress > 0.45: return 0
        if sleep < -0.45: return 8
        if workload > 0.4: return 7
        if study > 0.4: return 6
        if mood < -0.45: return 5
        return 5
    dqn_rewards = [simulated_reward(s, int(a)) for s, a in zip(heldout, choices)]
    fixed_rewards = [simulated_reward(s, fixed_rule(s)) for s in heldout]
    report = {"seed": SEED, "training_samples": 2000 * 128, "heldout_synthetic_profiles": len(heldout), "dqn_mean_simulated_reward": float(np.mean(dqn_rewards)), "fixed_rule_mean_simulated_reward": float(np.mean(fixed_rewards)), "reward_difference": float(np.mean(dqn_rewards) - np.mean(fixed_rewards)), "disclaimer": "Synthetic simulation comparison only; not evidence of real-world benefit or clinical effectiveness."}
    (POLICY_PATH.parent / "training_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"Saved simulated-data DQN policy to {POLICY_PATH}")


if __name__ == "__main__": main()
