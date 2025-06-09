function comparepieces(pieces) {
    const rank = {
        "司令": 10, "军长": 9, "师长": 8, "旅长": 7, "团长": 6,
        "营长": 5, "连长": 4, "排长": 3, "工兵": 2, "地雷": 1, "炸弹": -1
    };

    const { player1Piece, player2Piece } = pieces;
    let player1Status = "存活";
    let player2Status = "存活";

    if (player1Piece === "炸弹" || player2Piece === "炸弹") {
        player1Status = "阵亡";
        player2Status = "阵亡";
    } else if (player1Piece === "工兵" && player2Piece === "地雷") {
        player2Status = "阵亡";
    } else if (player2Piece === "工兵" && player1Piece === "地雷") {
        player1Status = "阵亡";
    } else if (player1Piece === "地雷" || player2Piece === "地雷") {
        if (player1Piece === "地雷") {
            player2Status = "阵亡";
        } else {
            player1Status = "阵亡";
        }
    } else {
        if (rank[player1Piece] > rank[player2Piece]) {
            player2Status = "阵亡";
        } else if (rank[player1Piece] < rank[player2Piece]) {
            player1Status = "阵亡";
        } else {
            player1Status = "阵亡";
            player2Status = "阵亡";
        }
    }

    return { player1Status, player2Status };
}

module.exports = {
    comparepieces
};
