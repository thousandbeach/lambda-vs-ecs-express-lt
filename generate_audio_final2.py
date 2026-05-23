#!/usr/bin/env python3
"""
LT音声一括生成スクリプト v2 (免責スライド追加版)
全9スライド / 約5分

使い方:
  1. export OPENAI_API_KEY="sk-..."
  2. python generate_audio.py
"""

import os
from pathlib import Path
from openai import OpenAI

# `.env` (リポジトリルート) があれば自動でロードする。
# python-dotenv が未インストールでも script は動く(その場合は素の環境変数のみ参照)。
try:
    from dotenv import load_dotenv  # type: ignore[import-not-found]
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass

SCRIPTS = [
    # SLIDE 1 - タイトル
    "お前の、ラムダ。それ、APIサーバーちゃうで。ラムダを、本業に戻す。2026年の、設計論。タカボです。よろしくお願いします。",

    # SLIDE 2 - 免責 (NEW)
    "はじめに、お断りを一つ。このLT、AIに書いてもらいました。クロードに、ちょい挑戦的に煽って、って頼んだら、こうなったんです。正直に言うと、ラムダもAWSも大好きです。煽り口調は、AIの仕業で、ワイの信念ちゃいますからね。という予防線を張って、始めます。",

    # SLIDE 3 - 告白
    "まず白状します。俺も、やってた。エクスプレスとか、ホノを、サーバーレスHTTPでラムダに載せる。APIゲートウェイの背後に置いて、ドメイン当てて、デプロイ一発。TypeScriptの型は、フロントと共有できるし、ゼロスケールで、インフラ管理も要らん。安い、と思ってた。ええやん?",

    # SLIDE 4 - 悲鳴
    "でも、運用始めたら、ラムダが悲鳴あげてた。一つ目。コールドスタートで、P99が崩壊する。Nodeでも数百ミリ秒、コンテナや重めやと数秒。SLOが、持たん。二つ目。6メガバイトのレスポンス壁で、S3逃がし地獄。ストリーミングで200メガまで行けるけど、APIゲートウェイ経由やと、結局10メガで詰まる。三つ目。DBコネクション問題。RDSプロキシ入れても、複雑さは残る。四つ目。ウォーマー入れたら、「それ、もう常駐やん。」五つ目。そして2025年8月から、INITフェーズが、課金対象になった。コールドスタートは、遅いだけやなくて、金もかかる問題に昇格した。ラムダに、罪はない。ミスキャストしたのは、俺や。",

    # SLIDE 5 - 居場所
    "ラムダの、本当の居場所、整理する。ラムダが最強なんは、イベント駆動の糊付け。SQSからのメッセージ処理、S3のファイルトリガー、イベントブリッジ、ウェブフック受信、クロン的なバッチ処理。逆に、押し付けると壊れるのは、常時ウォームなRESTAPI、ネクストのSSR、ウェブソケット、大きなレスポンスを返す仕事、DBのコネクションプール管理。ラムダは、イベントハンドラー。APIサーバーちゃうねん。",

    # SLIDE 6 - 数字
    "ここから、数字で殴る。同時実行、インスタンスあたり。ラムダは、1。クラウドランは、最大1000。実行時間。ラムダ、15分。クラウドラン、60分。レスポンス上限。ラムダ、バッファーで6メガ、ストリーミングで200メガ。クラウドラン、32メガ、HTTP2とストリーミングなら実質無制限。コールドスタート、両者とも数百ミリ秒から。同時実行、1対1000。IOバウンドなウェブAPIで、この差は、埋められん。",

    # SLIDE 7 - 金
    "次は、金の話で殴る。ほぼゼロのPoCフェーズなら、ラムダも、クラウドランも、ほぼ無料。日1000リクエストなら、クラウドランが、無料枠で勝ち。常時2、3台相当の負荷なら、どれも互角、ただしラムダはウォーマーとコールドスタート問題が乗る。常時10台を超えると、ラムダは高額化リスク、ECSエクスプレスが優勝。そして、2025年8月1日から、ラムダのINITフェーズが課金対象になった。ウォーマー戦略は、常駐コストと、コールドスタートの、最悪解になったんや。",

    # SLIDE 8 - 朗報
    "ここで、朗報や。2025年11月、AWSから、待望のクラウドラン対抗が出た。その名も、ECSエクスプレスモード。ちなみにアップランナーは、4月30日で新規受付停止。実質、バトンタッチやな。クラウドランにない、AWSならではの強み、3つ。一つ。全リソースが、自アカウント内で可視。クラウドランはグーグル側に隠れる、ここがAWSユーザーの安心感。二つ。ALB共有、最大25サービス。ホストヘッダールーティングで、マイクロサービス時代にコストが効く。三つ。通常ECSへの、シームレス移行。クラウドランからGKEへの断崖より、圧倒的になだらかや。機能面も、足りないものなし。カナリアデプロイ、自動ロールバック、追加料金なし、クラウドフォーメーション、CDK、テラフォーム、全部対応。アップランナーでは、対抗になれんかった。エクスプレスモードは、違う。",

    # SLIDE 9 - まとめ
    "2026年の、処方箋。一つ目。ラムダを、本業に戻せ。SQS、S3、イベントブリッジ、ウェブフック、クロン。ここで、ラムダは最強や。二つ目。APIサーバーには、コンテナ。制約なしのクラウドラン、AWS縛りなら、ついに対抗が来たECSエクスプレス。三つ目。1つの技術で全部やるな。ハイブリッドが正解。BFFはバーセル、APIはクラウドランかECSエクスプレス、イベントはラムダ、DB直結はエッジファンクションズ。適材適所。それだけの話や。",

    # SLIDE 10 - OUTRO
    "ところでね、このLTスライド、せっかくやから、ラムダから、ECSエクスプレスに、載せ替えませんか?今回は、机上のカタログスペック比較でした。次回は、実際にやってみた検証を、持ってきます。移行体験、実測ベンチマーク、設計判断ログ。これを次回のLTで報告します。ご清聴、ありがとうございました。",
]

OUTPUT_DIR = Path("audio")
MODEL = "gpt-4o-mini-tts"
VOICE = "onyx"
SPEED = 1.05
INSTRUCTIONS = "落ち着いた男性の声で、テクニカルトークらしく知的な雰囲気で、やや皮肉っぽい抑揚をつけて読んでください。句読点では適度に間を取ってください。"


def main():
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("❌ OPENAI_API_KEY 環境変数がセットされてません")
        print("   export OPENAI_API_KEY='sk-...' を実行してから再度お試しを")
        return

    client = OpenAI(api_key=api_key)
    OUTPUT_DIR.mkdir(exist_ok=True)

    total_chars = sum(len(s) for s in SCRIPTS)
    print(f"🎤 生成開始: {len(SCRIPTS)} スライド / 合計 {total_chars} 文字")
    print(f"   モデル: {MODEL}")
    print(f"   ボイス: {VOICE}")
    print(f"   速度: {SPEED}x")
    print(f"   推定コスト: 約 ${total_chars * 0.015 / 1000:.3f}")
    print()

    for i, script in enumerate(SCRIPTS, start=1):
        output_path = OUTPUT_DIR / f"slide_{i}.mp3"
        print(f"[{i}/{len(SCRIPTS)}] {len(script)}文字 → {output_path} ...", end=" ", flush=True)

        try:
            if MODEL == "gpt-4o-mini-tts":
                response = client.audio.speech.create(
                    model=MODEL,
                    voice=VOICE,
                    input=script,
                    speed=SPEED,
                    instructions=INSTRUCTIONS,
                )
            else:
                response = client.audio.speech.create(
                    model=MODEL,
                    voice=VOICE,
                    input=script,
                    speed=SPEED,
                )

            response.stream_to_file(output_path)
            print("✅")

        except Exception as e:
            print(f"❌ エラー: {e}")
            return

    print()
    print(f"🎉 完了! {OUTPUT_DIR}/ に {len(SCRIPTS)} ファイル生成")


if __name__ == "__main__":
    main()
