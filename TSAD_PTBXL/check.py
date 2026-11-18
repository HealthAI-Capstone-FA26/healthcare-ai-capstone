import tsadmetrics, inspect
names = [n for n in dir(tsadmetrics) if not n.startswith("_")]
print(names)

# Kiểm tra chữ ký các hàm mình đã dùng
for n in ["point_wise_f_score", "point_adjusted_f_score",
          "auc_roc_pw", "auc_pr_pw", "vus_roc", "vus_pr"]:
    f = getattr(tsadmetrics, n, None)
    print(n, "->", inspect.signature(f) if f else "KHÔNG TỒN TẠI")